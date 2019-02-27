/*!
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 * @author   Kopano <https://kopano.com>
 * @license  MIT
 * @preserve
 */

'use strict';

import * as URLSearchParams from 'url-search-params';
import { KWMErrorEvent, KWMStateChangedEvent, KWMTURNServerChangedEvent } from './events';
import { Plugins } from './plugins';
import {
	IRTMConnectResponse, IRTMDataError, IRTMTURNResponse, IRTMTypeEnvelope,
	IRTMTypeEnvelopeReply, IRTMTypeError, IRTMTypeHello, IRTMTypePingPong, IRTMTypeWebRTC,
	ISelf, ITURNConfig, RTMDataError } from './rtm';
import { makeAbsoluteURL } from './utils';
import { IWebRTCManagerContainer, PeerRecord, WebRTCManager } from './webrtc';

/**
 * The sequence counter for sent websocket message payloads. It is automatically
 * incremented whenever a payload message is sent via [[KWM.sendWebSocketPayload]].
 * @private
 */
let websocketSequence = 0;

export const authorizationTypeToken = 'Token';
export const authorizationTypeBearer = 'Bearer';
export const defaultAPIVersion = 'v2';

export interface IKWMOptions {
	authorizationType?: string;
	authorizationValue?: string;
	authorizationAuth?: string;
}

export interface IKWMEndpoints {
	rtmConnect: string;
	rtmTurn: string;
}

/**
 * IReplyTimeoutRecord is an interface to hold registered reply timeouts with a
 * resolve function.
 */
export interface IReplyTimeoutRecord {
	resolve: (message: IRTMTypeEnvelope) => void;
	timeout: number;
}

/**
 * KWMInit is a helper constructor to create KWM interface with settings and
 * callbacks.
 */
export class KWMInit {
	public static endpoints: any = {
		v1: {
			rtmConnect: '/api/v1/rtm.connect',
			rtmTurn: '/api/v1/rtm.turn',
		},
		v2: {
			rtmConnect: '/api/kwm/v2/rtm/connect',
			rtmTurn: '/api/kwm/v2/rtm/turn',
		},
	};

	public static options: any = {
		apiVersion: defaultAPIVersion,
		connectTimeout: 5000,
		heartbeatInterval: 5000,
		maxReconnectInterval: 30000,
		reconnectEnabled: true,
		reconnectFactor: 1.5,
		reconnectInterval: 1000,
		reconnectSpreader: 500,
	};

	public static init(options: any) {
		Object.assign(this.options, options);
	}

	constructor(callbacks: any = {}) {
		let url = callbacks.server || '';
		if (url) {
			const urlParser = document.createElement('a');
			urlParser.href = url;
			if (urlParser.protocol === 'wss:' || urlParser.protocol === 'ws:') {
				// Convert Websocket URLs to HTTP/HTTPS.
				urlParser.protocol = 'http' + urlParser.protocol.substr(2);
				url = urlParser.href;
			}
		}

		const options: IKWMOptions = {};
		if (callbacks.token) {
			options.authorizationType = authorizationTypeToken;
			options.authorizationValue = callbacks.token;
		}

		const kwm = new KWM(url, options);
		kwm.webrtc.config = {
			iceServers: callbacks.iceServers || [],
		};

		if (callbacks.success) {
			setTimeout(() => {
				callbacks.success();
			}, 0);
		}
		if (callbacks.error) {
			kwm.onerror = event => {
				callbacks.error(event);
			};
		}

		return kwm;
	}
}

/**
 * KWM is the main Kopano Web Meetings Javascript library entry point. It holds
 * the status and connections to KWM.
 */
export class KWM implements IWebRTCManagerContainer {
	public static version: string = __VERSION__;

	/**
	 * Boolean flag wether KWM is currently trying to establish a connection.
	 */
	public connecting: boolean = false;

	/**
	 * Boolean flag wether KWM is currently connected or not.
	 */
	public connected: boolean = false;

	/**
	 * Boolean flag wether KWM is automatically reconnecting or not.
	 */
	public reconnecting: boolean = false;

	/**
	 * Connection information as receveid by the server. This is only set if
	 * the KWM server connection is connected and hello has been received.
	 */
	public self?: ISelf;

	/**
	 * Event handler for [[KWMStateChangedEvent]]. Set to a function to get called
	 * whenever [[KWMStateChangedEvent]]s are triggered.
	 */
	public onstatechanged?: (event: KWMStateChangedEvent) => void;
	/**
	 * Event handler for [[KWMErrorEvent]]. Set to a function to get called
	 * whenever [[KWMErrorEvent]]s are triggered.
	 */
	public onerror?: (event: KWMErrorEvent ) => void;
	/**
	 * Event handler for [[KWMTURNServerChangedEvent]]. Set it to a function to
	 * get called whenever [[KWMTURNServerChangedEvent]]s are triggered.
	 */
	public onturnserverchanged?: (event: KWMTURNServerChangedEvent) => void;

	/**
	 * Reference to WebRTC related functionality in KWM.
	 */
	public webrtc: WebRTCManager;

	private baseURI: string;
	private options: IKWMOptions;
	private endpoints: IKWMEndpoints;
	private user?: string;
	private socket?: WebSocket;
	private closing: boolean = false;
	private reconnector: number = 0;
	private heartbeater: number = 0;
	private turnRefresher: number = 0;
	private latency: number = 0;
	private reconnectAttempts: number = 0;
	private replyHandlers: Map<number, IReplyTimeoutRecord>;

	/**
	 * Creates KWM instance with the provided parameters.
	 *
	 * @param baseURI The base URI to the KWM server API.
	 * @param options Additional options.
	 */
	constructor(baseURI: string = '', options?: IKWMOptions) {
		this.webrtc = new WebRTCManager(this);

		this.baseURI = baseURI.replace(/\/$/, '');
		this.options = options || {};
		this.replyHandlers = new Map<number, IReplyTimeoutRecord>();

		const endpoints = KWMInit.endpoints[KWMInit.options.apiVersion];
		if (!endpoints) {
			throw new Error('unknown apiVersion value: ' + KWMInit.options.apiVersion);
		}
		this.endpoints = endpoints;
	}

	/**
	 * Allows attaching plugins with callbacks to the accociated [[KWM]] instance.
	 *
	 * @param callbacks Object with callbacks.
	 */
	public attach(callbacks: any = {}): void {
		let plugin: any;
		let err: any;

		const pluginFactory = Plugins.get(callbacks.plugin);
		if (pluginFactory) {
			plugin = new pluginFactory(this, callbacks);
		} else {
			err = new Error('unknown plugin: ' + callbacks.plugin);
		}

		if (err) {
			if (callbacks.error) {
				setTimeout(() => {
					callbacks.error(err);
				}, 0);
				return;
			}

			throw err;
		}

		if (callbacks.success) {
			setTimeout(() => {
				callbacks.success(plugin);
			}, 0);
		}
	}

	/**
	 * Global destruction of all accociated resources.
	 *
	 * @param callbacks Object with callbacks.
	 */
	public destroy(callbacks: any = {}): void {
		this.reconnecting = false;
		this.webrtc.doHangup().then(() => {
			if (this.socket) {
				this.closeWebsocket(this.socket);
			}

			if (callbacks.success) {
				setTimeout(() => {
					callbacks.success();
				}, 0);
			}
		}).catch((reason: any) => {
			const err = new Error('failed to destroy: ' + reason);
			if (callbacks.error) {
				setTimeout(() => {
					callbacks.error(err);
				}, 0);
				return;
			}

			throw err;
		});
	}

	/**
	 * Establish Websocket connection to KWM server as the provided user.
	 *
	 * @param auth The authentication identifier.
	 * @param authMode The type of the authentication identifier value.
	 * @returns Promise which resolves when the connection was established.
	 */
	public async connect(auth: string, authMode: string = 'user'): Promise<void> {
		console.debug('KWM connect', auth, authMode);
		if (authMode === 'user') {
			// NOTE(longsleep): Keep a reference to user in user mode for
			// backwards compatibility.
			this.user = auth;
		} else {
			this.user = undefined;
		}

		clearTimeout(this.reconnector);
		clearTimeout(this.heartbeater);
		clearTimeout(this.turnRefresher);
		const reconnector = (fast: boolean = false): Promise<void> => {
			clearTimeout(this.reconnector);
			if (!this.reconnecting) {
				return Promise.resolve();
			}
			let reconnectTimeout = KWMInit.options.reconnectInterval;
			if (!fast) {
				reconnectTimeout *= Math.trunc(Math.pow(KWMInit.options.reconnectFactor, this.reconnectAttempts));
				if (reconnectTimeout > KWMInit.options.maxReconnectInterval) {
					reconnectTimeout = KWMInit.options.maxReconnectInterval;
				}
				reconnectTimeout += Math.floor(Math.random() * KWMInit.options.reconnectSpreader);
			}
			return new Promise<void>((resolve, reject) => {
				this.reconnector = window.setTimeout(() => {
					this.connect(auth, authMode).then(resolve).catch(reject);
				}, reconnectTimeout);
				this.reconnectAttempts++;
			});
		};
		const latencyMeter: number[] = [];
		const heartbeater = (init: boolean = false): void => {
			clearTimeout(this.heartbeater);
			if (!this.connected || this.closing) {
				return;
			}
			this.heartbeater = window.setTimeout(() => {
				heartbeater();
			}, KWMInit.options.heartbeatInterval);
			if (init) {
				return;
			}

			const payload: IRTMTypePingPong = {
				id: 0,
				ts: new Date().getTime(),
				type: 'ping',
			};
			const replyTimeout = KWMInit.options.heartbeatInterval / 100 * 90 ;
			const socket = this.socket;
			this.sendWebSocketPayload(payload, replyTimeout).then((message: IRTMTypeEnvelope) => {
				if (message.type !== 'pong') {
					// Ignore unknow stuff.
					return;
				}
				const pingMessage = message as IRTMTypePingPong;
				let latency = (new Date().getTime()) - pingMessage.ts;
				latencyMeter.push(latency);
				if (latencyMeter.length > 10) {
					latencyMeter.shift();
				}
				latency = latencyMeter.reduce((a, b) => {
					return a + b;
				});
				latency = Math.floor(latency / latencyMeter.length);
				if (socket === this.socket && latency !== this.latency) {
					this.latency = latency;
				}
				if (pingMessage.auth && this.options.authorizationType) {
					this.options.authorizationValue = pingMessage.auth;
				}
			}).catch((err: any) => {
				if (socket && this.socket === socket) {
					console.warn('heartbeat failed', err);
					// NOTE(longsleep): Close the socket asynchronously and directly trigger a
					// close event. This avoids issues where the socket is in a state which
					// cannot be closed yet.
					setTimeout(() => {
						this.closeWebsocket(socket);
					}, 0);
					const event = new CloseEvent('close', {
						reason: 'client heartbeat timeout',
					});
					socket.dispatchEvent(event);
				}
			});
		};
		const turnRefresher = (ttl: number): void => {
			clearTimeout(this.turnRefresher);
			if (this.closing) {
				return;
			}
			console.info(`KWM will refresh TURN settings in ${ttl} seconds`);
			this.turnRefresher = window.setTimeout(async () => {
				if (!this.connected || this.closing) {
					return;
				}
				let turnResult: IRTMTURNResponse;
				let authorizationHeader: string = '';
				if (this.options.authorizationType && this.options.authorizationValue) {
					authorizationHeader = this.options.authorizationType + ' ' + this.options.authorizationValue;
				}
				try {
					turnResult = await this.rtmTURN(auth, authMode, authorizationHeader);
				} catch (err) {
					console.warn('failed to refresh turn details, will retry', err);
					turnRefresher(5);
					return;
				}
				if (turnResult.turn) {
					this.handleTURNConfig(turnResult.turn, turnRefresher);
				}
			}, ttl * 1000);
		};

		this.reconnecting = KWMInit.options.reconnectEnabled;
		this.connecting = true;
		this.dispatchStateChangedEvent();

		return new Promise<void>(async (resolve, reject) => {
			let connectResult: IRTMConnectResponse;
			let authorizationHeader: string = '';
			if (this.options.authorizationType && this.options.authorizationValue) {
				authorizationHeader = this.options.authorizationType + ' ' + this.options.authorizationValue;
			}
			try {
				connectResult = await this.rtmConnect(auth, authMode, authorizationHeader);
			} catch (err) {
				console.warn('failed to fetch connection details', err);
				connectResult = {
					error: {
						code: 'request_failed',
						msg: '' + err,
					},
					ok: false,
				};
			}
			// console.debug('connect result', connectResult);
			if (!connectResult.ok || !connectResult.url) {
				this.connecting = false;
				this.dispatchStateChangedEvent();
				if (this.reconnecting) {
					if (connectResult.error && connectResult.error.code === 'http_error_403') {
						console.warn('giving up reconnect, as connect returned forbidden', connectResult.error.msg);
						this.reconnecting = false;
						this.dispatchStateChangedEvent();
						this.dispatchErrorEvent(connectResult.error);
					}
					return reconnector().then(resolve).catch(reject);
				} else if (connectResult.error) {
					reject(new RTMDataError(connectResult.error));
				} else {
					reject(new RTMDataError({code: 'unknown_error', msg: ''}));
				}
				return;
			}

			if (connectResult.turn) {
				this.handleTURNConfig(connectResult.turn, turnRefresher);
			}

			let url = connectResult.url;
			if (!url.includes('://')) {
				// Prefix with base when not absolute already.
				url = this.baseURI + url;
			}
			const start = new Date().getTime();
			this.createWebSocket(url, this.reconnecting ? reconnector : undefined).then(() => {
				this.reconnectAttempts = 0;
				this.latency = (new Date().getTime()) - start;
				latencyMeter.push(this.latency);
				console.debug('connection established', this.reconnectAttempts, this.latency);
				heartbeater(true);
				resolve();
			}, err => {
				console.warn('connection failed', err, !!this.reconnecting);
				if (this.reconnecting) {
					reconnector();
				} else {
					reject(err);
				}
			});
		});
	}

	/**
	 * Encode and send JSON payload data via [[KWM.socket]] connection.
	 *
	 * @private
	 * @param payload The payload data.
	 * @param replyTimeout Timeout in milliseconds for reply callback. If 0,
	 *        then no callback is expected and none is registered.
	 * @param record Record of the payloads target peer.
	 * @returns Promise which resolves when the reply was received or immediately
	 *          when no timeout was given.
	 */
	public async sendWebSocketPayload(
		payload: IRTMTypeEnvelope,
		replyTimeout: number = 0,
		record?: PeerRecord): Promise<IRTMTypeEnvelope> {
		return new Promise<IRTMTypeEnvelope>((resolve, reject) => {
			if (!this.connected || !this.socket || this.closing) {
				reject(new Error('no_connection'));
				return;
			}

			payload.id = ++websocketSequence;
			// console.debug('>>> payload', payload.id, payload);
			try {
				this.socket.send(JSON.stringify(payload));
			} catch (err) {
				reject(err);
				return;
			}
			if (replyTimeout > 0) {
				const timeout = window.setTimeout(() => {
					reject(new Error('timeout'));
				}, replyTimeout);
				this.replyHandlers.set(payload.id, {resolve, timeout});
			} else {
				setTimeout(resolve, 0);
			}
		});
	}

	/**
	 * Dispatch a new [[KWMStateChangedEvent]].
	 * @private
	 */
	public dispatchStateChangedEvent(): KWMStateChangedEvent {
		const e = new KWMStateChangedEvent(this);
		this.dispatchEvent(e);
		return e;
	}

	/**
	 * Dispatch a new [[KWMErrorEvent]] with the provided error details.
	 * @private
	 */
	public dispatchErrorEvent(err: IRTMDataError): KWMErrorEvent {
		const e = new KWMErrorEvent(this, err);
		this.dispatchEvent(e);
		return e;
	}

	/**
	 * Dispatch a new [[KWMTURNServerChangedEvent]] with the provided details.
	 * @private
	 */
	public dispatchKWMTURNServerChangedEvent(ttl: number, iceServer: RTCIceServer): KWMTURNServerChangedEvent {
		const e = new KWMTURNServerChangedEvent(this, ttl, iceServer);
		this.dispatchEvent(e);
		return e;
	}

	/**
	 * Call KWM RTM rtm.connect via REST to retrieve Websocket endpoint details.
	 *
	 * @param auth The authentication identifier.
	 * @param authMode The type of the authentication identifier value.
	 * @param authorizataionHeader Authorization HTTP request header value.
	 * @returns Promise with the unmarshalled response data once received.
	 */
	private async rtmConnect(
		auth: string, authMode: string = 'user', authorizationHeader?: string): Promise<IRTMConnectResponse> {
		const url = this.baseURI + this.endpoints.rtmConnect;
		const headers = new Headers();
		if (authorizationHeader) {
			headers.set('Authorization', authorizationHeader);
		}
		headers.set('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
		const params = new URLSearchParams();
		params.set(authMode, auth);
		if (this.options.authorizationAuth) {
			params.set('auth', this.options.authorizationAuth);
		}

		return fetch(url, {
			body: params.toString(),
			headers,
			method: 'POST',
			mode: 'cors',
		}).then(response => {
			if (!response.ok) {
				return {
					error: {
						code: 'http_error_' + response.status,
						msg: response.statusText,
					},
					ok: false,
				};
			}

			return response.json();
		});
	}

	/**
	 * Call KWM RTM rtm.turn via REST to retrieve TURN details.
	 *
	 * @param auth The authentication identifier.
	 * @param authMode The type of the authentication identifier value.
	 * @param authorizataionHeader Authorization HTTP request header value.
	 * @returns Promise with the unmarshalled response data once received.
	 */
	private async rtmTURN(
		auth: string, authMode: string = 'user',
		authorizationHeader?: string): Promise<IRTMTURNResponse> {
		const url = this.baseURI + this.endpoints.rtmTurn;
		const headers = new Headers();
		if (authorizationHeader) {
			headers.set('Authorization', authorizationHeader);
		}
		headers.set('Content-Type', 'application/x-www-form-urlencoded; charset=UTF-8');
		const params = new URLSearchParams();
		params.set(authMode, auth);
		if (this.options.authorizationAuth) {
			params.set('auth', this.options.authorizationAuth);
		}

		return fetch(url, {
			body: params.toString(),
			headers,
			method: 'POST',
			mode: 'cors',
		}).then(response => {
			if (!response.ok) {
				return {
					error: {
						code: 'http_error_' + response.status,
						msg: response.statusText,
					},
					ok: false,
				};
			}

			return response.json();
		});
	}

	/**
	 * Create a new KWM RTM Websocket connection using the provided uri. If
	 * the accociated KWM instance already has a connection, the old connection
	 * will be closed before the new connection is established.
	 *
	 * @param uri URI or URL to use. The value will be made absolute if not
	 *        already absolute. The scheme will be transformed to `ws:` or `wss:`
	 *        if `http:` or `https:`.
	 */
	private async createWebSocket(uri: string, reconnector?: (fast?: boolean) => void): Promise<WebSocket> {
		console.debug('create websocket', uri);

		return new Promise<WebSocket>((resolve, reject) => {
			if (this.socket) {
				console.warn('closing existing socket connection');
				const oldSocket = this.socket;
				this.socket = undefined;
				this.connected = false;
				this.closeWebsocket(oldSocket);
			}

			const url = makeAbsoluteURL(uri).replace(/^https:\/\//i, 'wss://').replace(/^http:\/\//i, 'ws://');
			console.debug('connecting socket URL', url);
			const socket = new WebSocket(url);

			let isTimeout = false;
			const timeout = setTimeout(() => {
				isTimeout = true;
				if (socket === this.socket) {
					this.socket = undefined;
					this.connected = false;
					this.connecting = false;
					this.dispatchStateChangedEvent();
				}
				setTimeout(() => {
					this.closeWebsocket(socket);
				}, 0);
				reject(new Error('connect_timeout'));
			}, KWMInit.options.connectTimeout);

			socket.onopen = (event: Event) => {
				clearTimeout(timeout);
				if (isTimeout) {
					return;
				}
				setTimeout(() => {
					resolve(event.target as WebSocket);
				}, 0);
				if (event.target !== this.socket) {
					return;
				}
				console.debug('socket connected', event);
				this.connected = true;
				this.connecting = false;
				this.socket.onmessage = this.handleWebSocketMessage.bind(this);
			};
			socket.onclose = (event: CloseEvent) => {
				clearTimeout(timeout);
				if (isTimeout) {
					return;
				}
				if (event.target !== this.socket) {
					if (!this.socket && !this.connecting && reconnector) {
						console.debug('socket closed, retry immediate reconnect now', event);
						// Directly try to reconnect. This makes reconnects fast
						// in the case where the connection was lost on the client
						// and has come back.
						reconnector(true);
					}
					return;
				}
				console.debug('socket closed', event);
				this.socket = undefined;
				this.self = undefined;
				this.closing = false;
				this.connected = false;
				this.connecting = false;
				this.dispatchStateChangedEvent();
				if (reconnector) {
					reconnector();
				}
			};
			socket.onerror = (event: Event) => {
				clearTimeout(timeout);
				if (isTimeout) {
					return;
				}
				setTimeout(() => {
					reject(event);
				}, 0);
				if (event.target !== this.socket) {
					return;
				}
				console.debug('socket error', event);
				this.socket = undefined;
				this.self = undefined;
				this.connected = false;
				this.connecting = false;
				this.dispatchErrorEvent({
					code: 'websocket_error',
					msg: '' + event,
				});
				this.dispatchStateChangedEvent();
			};

			this.closing = false;
			this.socket = socket;
		});
	}

	/**
	 * Closes the provided websocket connection.
	 *
	 * @param socket Websocket to close.
	 */
	private closeWebsocket(socket: WebSocket): void {
		if (socket === this.socket) {
			this.closing = true;
		}
		socket.close();
	}

	/**
	 * Handles server generated TURN settings.
	 *
	 * @param turnConfig TURN configuration.
	 * @param refresher Callback function which gets called to register refresh.
	 */
	private handleTURNConfig(turnConfig?: ITURNConfig, refresher?: (ttl: number) => void): void {
		if (turnConfig && turnConfig.uris) {
			const turnICEServer: RTCIceServer = {
				credential: turnConfig.password,
				urls: turnConfig.uris,
				username: turnConfig.username,
			};
			const e = this.dispatchKWMTURNServerChangedEvent(turnConfig.ttl, turnICEServer);
			if (!e.defaultPrevented) {
				// Replace all configured ICE servers with the one we received.
				this.webrtc.config.iceServers = [turnICEServer];
			}

			if (refresher && turnConfig.ttl) {
				const ttl = turnConfig.ttl / 100 * 90;
				refresher(ttl);
			}
		}
	}

	/**
	 * Process incoming KWM RTM API Websocket payload data.
	 *
	 * @param event Websocket event holding payload data.
	 */
	private handleWebSocketMessage(event: MessageEvent): void {
		if (event.target !== this.socket) {
			(event.target as WebSocket).close();
			return;
		}

		// console.debug('socket message', event);
		const message: IRTMTypeEnvelope = JSON.parse(event.data);
		const reply = message as IRTMTypeEnvelopeReply;
		if (reply.type === 'pong') {
			// Special case for pongs, which just reply back everything.
			reply.reply_to = reply.id;
		}
		if (reply.reply_to) {
			const replyTimeout = this.replyHandlers.get(reply.reply_to);
			if (replyTimeout) {
				this.replyHandlers.delete(reply.reply_to);
				clearTimeout(replyTimeout.timeout);
				replyTimeout.resolve(message);
			} else {
				console.log('received kwm reply without handler', reply);
			}
			return;
		}

		switch (message.type) {
			case 'hello': {
				console.debug('kwm server hello', message);
				const helloMessage = message as IRTMTypeHello;
				this.self = helloMessage.self;
				this.webrtc.handleHello(helloMessage, this.user);
				this.dispatchStateChangedEvent();
				break;
			}
			case 'goodbye':
				console.debug('kwm server goodbye, close connection', message);
				this.reconnectAttempts = 1; // NOTE(longsleep): avoid instant reconnect.
				this.closeWebsocket(this.socket);
				this.connected = false;
				break;
			case 'webrtc':
				this.webrtc.handleWebRTCMessage(message as IRTMTypeWebRTC);
				break;
			case 'error':
				console.warn('kwm server error', message);
				this.dispatchErrorEvent((message as IRTMTypeError).error);
				break;
			default:
				console.debug('unknown kwm message type', message.type, message);
				break;
		}
	}

	/**
	 * Generic event dispatcher. Dispatches callback functions based on event
	 * types. Throws error for unknown event types. If a known event type has no
	 * event handler registered, dispatchEvent does nothing.
	 *
	 * @param event Event to be dispatched.
	 */
	private dispatchEvent(event: any): void {
		switch (event.constructor.getName()) {
			case KWMStateChangedEvent.getName():
				if (this.onstatechanged) {
					this.onstatechanged(event);
				}
				break;
			case KWMErrorEvent.getName():
				if (this.onerror) {
					this.onerror(event);
				}
				break;
			case KWMTURNServerChangedEvent.getName():
				if (this.onturnserverchanged) {
					this.onturnserverchanged(event);
				}
				break;
			default:
				throw new Error('unknown event: ' + event.constructor.getName());
		}
	}
}
