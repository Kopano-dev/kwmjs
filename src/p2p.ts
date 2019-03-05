/*
 * Copyright 2019 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import * as SimplePeer from 'simple-peer';

import { WebRTCAnnounceStreamsEvent, WebRTCPeerEvent, WebRTCStreamTrackEvent } from './events';
import { IRTMTypeEnvelope, IRTMTypeSubTypeEnvelope, IRTMTypeWebRTC } from './rtm';
import { getRandomString } from './utils';
import { WebRTCBaseManager } from './webrtc';

/**
 * The sequence counter for sent data channel message payloads. It is automatically
 * incremented whenever a payload message is sent via [[P2PController.sendDatachannelPayload]].
 * @private
 */
let datachannelSequence = 0;
let localStreamSequence = 0;

interface IP2PTypeHandshake extends IRTMTypeSubTypeEnvelope {
	v: number;
	ts: number;
	data?: any;
}

interface IP2PStreamAnnouncement {
	v: number;
	id: string;
	kind: string;
	token: string;
}

interface IP2PTypeAnnounceStreams extends IRTMTypeSubTypeEnvelope {
	streams: IP2PStreamAnnouncement[];
}

class P2PRecord {
	public id: string = '';
	public pc: SimplePeer;
	public user: string = '';
	public config?: any;
	public initiator: boolean = false;

	public connected: boolean = false;
	public ready: boolean = false;

	public ts: number = 0;
	public handshake?: IP2PTypeHandshake;

	public streams: Map<string, StreamRecord>;

	constructor(id: string, pc: SimplePeer, user: string, config: any, initiator: boolean) {
		this.id = id;
		this.pc = pc;
		this.user = user;
		this.config = config;
		this.initiator = initiator;

		this.streams = new Map<string, StreamRecord>();
	}
}

class StreamRecord {
	public static version: number = 1;

	public id: string = '';
	public kind: string = '';
	public stream?: MediaStream;
	public sequence: number = 0;
	public token: string = '';
	public connections: Map<string, SimplePeer>;
	public options?: any;

	private controller: P2PController;

	constructor(controller: P2PController, id: string, kind: string, stream?: MediaStream) {
		this.controller = controller;
		this.id = id;
		this.connections = new Map<string, SimplePeer>();

		// Check for supported kinds.
		switch (kind) {
			case 'screenshare':
				console.debug('p2p screenshare announced, preparing', controller.webrtc.options);
				this.options = {
					...controller.webrtc.options,
					answerConstraints: {
						...controller.webrtc.options.answerConstraints,
						offerToReceiveAudio: false,
						offerToReceiveVideo: !stream,
					},
					kind,
					offerConstraints: {
						...controller.webrtc.options.offerConstraints,
						offerToReceiveAudio: false,
						offerToReceiveVideo: !stream,
					},
				};
				break;

			default:
				// Ignore unknown types.
				return;
		}

		this.stream = stream;
		this.sequence = ++localStreamSequence;
		this.kind = kind;
	}

	public getP2PConnection = (record: P2PRecord, message: IRTMTypeWebRTC): (SimplePeer | undefined) => {
		// console.debug('p2p stream record callback', record, message);
		if (message.subtype !== 'webrtc_signal') {
			// Do nothing for other messages.
			return;
		}

		let pc = this.connections.get(record.id);
		if (!pc) {
			// console.debug('p2p start webrtc, callback triggered', record.id, this.connections);
			const streams: MediaStream[] = [];
			if (this.stream) {
				streams.push(this.stream);
			}
			pc = this.controller.getPeerConnection(record, {
				...this.options,
				source: this.token, // NOTE(longsleep): Use source to pass along token.
				streams,
			});
			this.connections.set(record.id, pc);
		}

		// Handle imcoming messages.
		switch (message.subtype) {
			case 'webrtc_signal':
				if (message.data && message.data.sdp && this.options.remoteSDPTransform) {
					// Remote SDP transform support.
					message.data.sdp = this.options.remoteSDPTransform(message.data.sdp, this.options.kind);
				}
				pc.signal(message.data);
				break;
		}

		return pc;
	}

	public destroy(): void {
		this.connections.forEach((pc: SimplePeer) => {
			pc.destroy();
		});
		this.connections.clear();
		this.stream = undefined;
	}
}

export class P2PController {
	/**
	 * Data channel payload version. All data channel payloads will include this
	 * value and clients can use it to check if they are compatible with the
	 * received data. This client will reject all messages which are from
	 * received with older version than defined here.
	 */
	public static version: number = 20190225;

	public webrtc: WebRTCBaseManager;

	private connections: Map<string, P2PRecord>;
	private localStreams: Map<string, StreamRecord>;

	private callbacks: Map<string, (record: P2PRecord, message: IRTMTypeWebRTC) => SimplePeer | undefined>;

	constructor(webrtc: WebRTCBaseManager) {
		this.webrtc = webrtc;

		this.connections = new Map<string, P2PRecord>();
		this.localStreams = new Map<string, StreamRecord>();
		this.callbacks = new Map<string, (record: P2PRecord, message: IRTMTypeWebRTC) => SimplePeer | undefined>();
	}

	public registerConnection(pc: SimplePeer, user: string, config: any): void {
		// console.debug('p2p add', pc._id, pc.initiator, user, config);
		const id = this.getConnectionID(pc);
		const old = this.connections.get(id);
		if (old) {
			console.warn('p2p controller add of existing connection', id);
		}
		const record = new P2PRecord(id, pc, user, config, pc.initiator);
		this.connections.set(id, record);
	}

	public setLocalStream(id: string, kind: string, stream?: MediaStream): void {
		const old = this.localStreams.get(id);
		let record: StreamRecord | undefined;
		if (stream) {
			record = new StreamRecord(this, id, kind, stream);
			if (old) {
				if (old.kind !== record.kind) {
					throw new Error('p2p set local stream with different kind');
				}
				record.connections = old.connections;
				record.token = old.token;
			} else {
				record.token = getRandomString(16);
			}
			this.localStreams.set(id, record);
			this.callbacks.set(record.token, record.getP2PConnection);
		} else {
			this.localStreams.delete(id);
			if (old) {
				this.callbacks.delete(old.token);
				record = old;
			}
		}

		// console.debug('p2p set stream', record, old);

		// TODO(longsleep):
		// announce stream changes to all connections.
		if (old && record && stream) {
			// 1. check if stream is replaced, if so update existing connections
			//    with replaceStream.
			record.connections.forEach((pc: SimplePeer, key: string) => {
				// console.debug('p2p update stream', pc, key);
				// TODO(longsleep): Use replace track for certain kinds.
				if (old.stream) {
					pc.removeStream(old.stream);
				}
				pc.addStream(stream);
			});
			// Done, replaced all.
			return;
		} else if (old && record) {
			// 2. check if stream is removed, kill of all existing connections for
			//    this stream.
			record.destroy();
		}

		// 3. announce stream changes to p2p.
		this.announceStreams(undefined, true);
	}

	public handleConnect(pc: SimplePeer): void {
		// console.debug('p2p connect', pc._id);
		const id = this.getConnectionID(pc);
		const record = this.connections.get(id);
		if (!record) {
			console.warn('p2p controller connect of unknown connection', id);
			return;
		}
		if (record.connected) {
			console.warn('p2p controller connect when already connected', id);
			return;
		}
		if (record.pc !== pc) {
			throw new Error('p2p connection does not match record');
		}

		record.ts = new Date().getTime();
		const payload: IP2PTypeHandshake = {
			id: 0,
			subtype: 'handshake',
			ts: record.ts,
			type: 'p2p',
			v: P2PController.version,
		};
		if (record.handshake) {
			// Include handshake reply.
			const reply: IP2PTypeHandshake = {
				id: 0,
				subtype: 'handshake_reply',
				ts: record.handshake.ts,
				type: 'p2p',
				v: record.handshake.v,
			};
			payload.data = reply;
		}

		record.connected = true;
		this.sendDatachannelPayload(payload, 0, pc);
	}

	public handleClose(pc: SimplePeer): void {
		// console.debug('p2p close', pc._id);
		const id = this.getConnectionID(pc);
		const record = this.connections.get(id);
		if (record && record.pc !== pc) {
			// Not a match. Ignore.
			return;
		}
		if (record) {
			record.ready = false;
			record.connected = false;
			record.handshake = undefined;
			this.connections.delete(id);
			record.streams.forEach(streamRecord => {
				streamRecord.destroy();
			});
			record.streams.clear();
		}
	}

	public handleData(pc: SimplePeer, data: string): void {
		// console.debug('data channel message', pc._id, data);
		const id = this.getConnectionID(pc);
		const record = this.connections.get(id);
		if (!record) {
			console.warn('p2p controller data for unknown connection', id);
			return;
		}
		if (record.pc !== pc) {
			throw new Error('p2p connection does not match record');
		}

		let message: IRTMTypeEnvelope;
		try {
			message = JSON.parse(data);
		} catch (err) {
			console.debug('failed to parse data channel message as JSON - message ignored', id, err);
			return;
		}

		switch (message.type) {
			case 'p2p':
				this.handleP2PMessage(record, message as IRTMTypeSubTypeEnvelope);
				break;

			case 'webrtc':
				this.handleWebRTCMessage(record, message as IRTMTypeWebRTC);
				break;

			default:
				console.debug('unknown data channel message type', id, message.type);
				break;
		}
	}

	public getPeerConnection(record: P2PRecord, opts?: any): SimplePeer {
		const { streams, localSDPTransform, remoteSDPTransform, source, kind, ...options } = opts;

		const pc = new SimplePeer({
			config: record.config,
			initiator: record.initiator,
			sdpTransform: (sdp: any) => {
				if (localSDPTransform) {
					return localSDPTransform(sdp, kind);
				}
				return sdp;
			},
			streams,
			trickle: true,
			...options,
		});
		pc.on('error', err => {
			console.warn('p2p connection error', pc._id, err);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.error', record, err));
		});
		pc.on('signal', data => {
			// console.debug('p2p connection signal', pc._id, data);
			const payload = {
				data,
				id: 0,
				pcid: pc._id,
				source,
				subtype: 'webrtc_signal',
				type: 'webrtc',
				v: WebRTCBaseManager.version,
			};
			// console.debug('>>> send p2p signal'te, payload);
			this.sendDatachannelPayload(payload, 0, record.pc);
		});
		pc.on('connect', () => {
			console.debug('p2p connection connect', pc._id);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.connect', record, pc));
		});
		pc.on('close', () => {
			console.debug('p2p connection close', pc._id);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.closed', record, pc));
		});
		pc.on('iceStateChange', state => {
			console.debug('p2p iceStateChange', pc._id, state);
		});
		pc.on('signalingStateChange', state => {
			console.debug('p2p signalingStateChange', pc._id, state);
		});

		console.debug('p2p peerconnection new', pc._id);
		return pc;
	}

	private getConnectionID(pc: SimplePeer): string {
		return pc._id;
	}

	private announceStreams(record?: P2PRecord, force: boolean = false): void {
		const streams = Array<IP2PStreamAnnouncement>();
		this.localStreams.forEach((streamRecord: StreamRecord) => {
			streams.push({
				id: streamRecord.id,
				kind: streamRecord.kind,
				token: streamRecord.token,
				v: StreamRecord.version,
			});
		});
		if (streams.length === 0 && !force) {
			return;
		}

		const payload: IP2PTypeAnnounceStreams = {
			id: 0,
			streams,
			subtype: 'announce_streams',
			type: 'p2p',
		};

		if (record) {
			if (!record.ready || !record.pc) {
				throw new Error('p2p record not ready to announce streams');
			}
			this.sendDatachannelPayload(payload, 0, record.pc);
		} else {
			// Send to all if no record given.
			this.connections.forEach((p2pRecord: P2PRecord) => {
				if (p2pRecord.ready && p2pRecord.pc) {
					this.sendDatachannelPayload(payload, 0, p2pRecord.pc);
				}
			});
		}
	}

	private handleAnnounceStreams(record: P2PRecord, message: IP2PTypeAnnounceStreams): void {
		console.debug('p2p announce stream', record, message.streams);
		// Create and drop extra record connections for each announced stream.
		const status = new Map<string, boolean>();
		const added: IP2PStreamAnnouncement[] = [];
		const streams = record.streams;

		message.streams.forEach(streamAnnouncement => {
			const streamRecord = streams.get(streamAnnouncement.id);
			if (streamRecord) {
				// Already got that.
				if (streamRecord.kind !== streamAnnouncement.kind) {
					// Ignore changes of stream kind.
					return;
				}
				if (streamRecord.token !== streamAnnouncement.token) {
					this.callbacks.delete(streamRecord.token);
					streamRecord.token = streamAnnouncement.token;
					this.callbacks.set(streamRecord.token, streamRecord.getP2PConnection);
				}
				status.set(streamAnnouncement.id, false);
			} else {
				status.set(streamAnnouncement.id, true);
				added.push(streamAnnouncement);
			}
		});

		const removed: StreamRecord[] = [];
		streams.forEach(streamRecord => {
			if (!status.has(streamRecord.id)) {
				streams.delete(streamRecord.id);
				removed.push(streamRecord);
				// Remove connections for removed streams.
				streamRecord.destroy();
			}
		});

		if (!removed.length && !added.length) {
			// Nothing todo.
			return;
		}
		this.webrtc.dispatchEvent(
			new WebRTCAnnounceStreamsEvent(this.webrtc, 'p2p.announce_streams', record, added, removed));
		console.debug('p2p streams have changed', removed.length, added.length);

		added.forEach(streamAnnouncement => {
			const id = streamAnnouncement.id;
			const streamRecord = new StreamRecord(
				this,
				id,
				streamAnnouncement.kind,
			);
			if (streamRecord.kind !== streamAnnouncement.kind) {
				console.warn('p2p rejected new stream announcement kind for', streamRecord.kind);
				return;
			}

			streamRecord.token = streamAnnouncement.token;

			this.callbacks.set(streamRecord.token, streamRecord.getP2PConnection);
			streams.set(id, streamRecord);

			// Create new connection for announced stream.
			const old = streamRecord.connections.get(id);
			if (old) {
				// Already have a connection.
				console.debug('p2p already have that connection, so keep it and do nothing', record.id, id);
			} else {
				console.debug('p2p start webrtc, announce received', record.id, id);
				const pc = this.getPeerConnection(record, {
					...streamRecord.options,
					source: streamAnnouncement.token, // NOTE(longsleep): Use source to pass along token.
				});
				pc.on('track', (track, mediaStream) => {
					this.webrtc.dispatchEvent(
						new WebRTCStreamTrackEvent(
							this.webrtc, 'pc.track', record, track, mediaStream, streamRecord.token),
					);
				});
				streamRecord.connections.set(record.id, pc);
				if (!record.initiator) {
					// Since we are not marked as initiator, let other side know
					// that we are ready to start webrtc.
					pc.emit('signal', {
						renegotiate: true,
					});
				}
			}
		});
	}

	private handleP2PMessage(record: P2PRecord, message: IRTMTypeSubTypeEnvelope): void {
		// console.debug('p2p message', record.id, message.subtype, message);
		switch (message.subtype) {
			case 'handshake': {
				if (record.handshake) {
					console.warn('p2p connection received handshake, but already have handshaked', record.id);
					return;
				}

				const handshake = message as IP2PTypeHandshake;
				record.handshake = handshake;

				if (record.connected && record.pc) {
					// Send out handshake reply.
					// Include handshake reply.
					const reply: IP2PTypeHandshake = {
						id: 0,
						subtype: 'handshake_reply',
						ts: handshake.ts,
						type: 'p2p',
						v: handshake.v,
					};
					this.sendDatachannelPayload(reply, 0, record.pc);
				}
				if (handshake.data) {
					const reply = handshake.data as IP2PTypeHandshake;
					if (reply.type === 'p2p' && reply.subtype !== 'handshake') {
						// Assert that there will be no loop, then feed into pipe.
						this.handleP2PMessage(record, reply);
					}
				}
				break;
			}

			case 'handshake_reply': {
				const handshake = message as IP2PTypeHandshake;
				// console.debug('handshake reply', handshake.v, handshake.ts, record.ts);
				if (handshake.ts !== record.ts || handshake.v !== P2PController.version) {
					console.warn('p2p handshake failed, data mismatch', record.id, handshake.ts, record.ts);
					return;
				}
				const now = new Date().getTime();
				record.ready = true;
				const duration = now - handshake.ts;
				console.info('p2p handshake success after', record.id, duration);
				// TODO(longsleep): Make a ready handler.
				this.announceStreams(record);
				break;
			}

			case 'announce_streams': {
				const announce = message as IP2PTypeAnnounceStreams;
				// console.debug('announce streams', announce.streams);
				this.handleAnnounceStreams(record, announce);
				break;
			}

			default:
				console.debug('unknown p2p message subtype', record.id, message.subtype);
				break;
		}
	}

	private handleWebRTCMessage(record: P2PRecord, message: IRTMTypeWebRTC): void {
		// console.debug('<<< webrtc', message);

		if (!message.v || message.v < WebRTCBaseManager.version) {
			console.debug('webrtc ignoring p2p message with outdated version', message.v, message);
			return;
		}

		// TODO find our end by looking at the source which is a token we previously created.
		const callback = this.callbacks.get(message.source);
		if (!callback) {
			console.debug('webrtc ignoring p2p message with unknown callback source', message.source);
			// Ignore unknown callbacks
			return;
		}

		const pc = callback(record, message);
		if (!pc) {
			console.debug('webrtc no connection for p2p message with callback source', message.source);
			return;
		}
	}

	/**
	 * Encode and send JSON payload data via pc data channel connection.
	 *
	 * @private
	 * @param payload The payload data.
	 * @param replyTimeout Timeout in milliseconds for reply callback. If 0,
	 *        then no callback is expected and none is registered.
	 * @param pc Peer connection for sending.
	 * @returns Promise which resolves when the reply was received or immediately
	 *          when no timeout was given.
	 */
	private async sendDatachannelPayload(
		payload: IRTMTypeEnvelope,
		replyTimeout: number = 0,
		pc: SimplePeer): Promise<IRTMTypeEnvelope> {
		return new Promise<IRTMTypeEnvelope>((resolve, reject) => {
			if (pc.destroyed) {
				reject(new Error('connection_is_destroyed'));
			}

			payload.id = ++datachannelSequence;
			// console.debug('>>> payload', payload.id, payload, pc._id);
			try {
				pc.send(JSON.stringify(payload));
			} catch (err) {
				reject(err);
				return;
			}
			if (replyTimeout > 0) {
				reject(new Error('p2p data channel reply not implemented'));
			} else {
				setTimeout(resolve, 0);
			}
		});
	}
}
