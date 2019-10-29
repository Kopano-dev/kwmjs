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

export interface IP2PTypeHandshake extends IRTMTypeSubTypeEnvelope {
	v: number;
	ts: number;
	data?: any;
}

export interface IP2PStreamAnnouncement {
	v: number;
	id: string;
	kind: string;
	token: string;
}

export interface IP2PTypeAnnounceStreams extends IRTMTypeSubTypeEnvelope {
	streams: IP2PStreamAnnouncement[];
}

/**
 * A P2PRecord represents a current or future connections p2p status.
 */
class P2PRecord {
	public id = '';
	public pc: SimplePeer;
	public user = '';
	public config?: any;
	public initiator = false;
	public reconnect = true;
	public connected = false;
	public ready = false;

	public ts = 0;
	public handshake?: IP2PTypeHandshake;

	public streams: Map<string, StreamRecord>;

	public constructor(id: string, pc: SimplePeer, user: string, config: any, initiator: boolean) {
		this.id = id;
		this.pc = pc;
		this.user = user;
		this.config = config;
		this.initiator = initiator;

		this.streams = new Map<string, StreamRecord>();
	}
}

/**
 * A PCRecord represents a local peer connection together with a remote pc id.
 */
class PCRecord {
	public pc?: SimplePeer;
	public rpcid?: string;
}

/**
 * A StreamRecord represents a current or future p2p stream with its connections.
 */
export class StreamRecord {
	public static version = 1;

	public id = '';
	public kind = '';
	public stream?: MediaStream;
	public sequence = 0;
	public token = '';
	public connections: Map<string, PCRecord>;
	public options?: any;

	private controller: P2PController;

	public constructor(controller: P2PController, id: string, kind: string, stream?: MediaStream) {
		this.controller = controller;
		this.id = id;
		this.connections = new Map<string, PCRecord>();

		// Check for supported kinds.
		switch (kind) {
			case 'screenshare':
				console.debug('p2p screenshare announced, preparing', controller.webrtc.options);
				this.options = {
					...controller.webrtc.options,
					answerConstraints: {
						...controller.webrtc.options.answerConstraints,
					},
					kind,
					offerConstraints: {
						...controller.webrtc.options.offerConstraints,
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

	/**
	 * Gets or creates a new [[SimplePeer]] connection for the accociated stream using the
	 * provided p2p record.
	 *
	 * @param record P2p record.
	 * @param message P2p WebRTC message as received.
	 * @returns Connection for the accociated stream for the provided record.
	 */
	public handleWebRTC = (record: P2PRecord, message: IRTMTypeWebRTC): (SimplePeer | undefined) => {
		// console.debug('p2p stream record callback', record, message);
		let binder: PCRecord | undefined;

		// Handle imcoming messages.
		switch (message.subtype) {
			case 'webrtc_signal':
				if (!message.data) {
					console.warn('p2p webrtc signal data empty');
					break;
				}

				binder = this.connections.get(record.id) as PCRecord;
				if (!binder) {
					binder = new PCRecord();
				}

				if (message.pcid !== binder.rpcid) {
					if (binder.rpcid === undefined) {
						if (binder.pc && message.pcid !== undefined) {
							// Not bound yet, accept and bind incoming id.
							binder.rpcid = message.pcid;
							console.log('bound p2p webrtc, received signal', message.pcid, binder.pc._id);
						}
					} else {
						// Existing connection but other remote pcid. What now?
						console.info('p2p webrtc signal with new pcid', binder.rpcid, message.pcid);
						if (binder.pc) {
							// Kill off existing pc cleanly to start fresh on both sides.
							binder.pc.destroy();
							binder.pc = undefined;
						}
					}
				}

				if (!binder.pc) {
					console.debug('p2p start webrtc, callback triggered', message.pcid);
					const streams: MediaStream[] = [];
					if (this.stream) {
						streams.push(this.stream);
					}
					const pc2 = this.controller.getPeerConnection(record, binder, {
						...this.options,
						source: this.token, // NOTE(longsleep): Use source to pass along token.
						streams,
					}, (pc: SimplePeer): void => {
						console.debug('created p2p pc', pc._id, pc, record.initiator);
						if (binder) {
							binder.rpcid = message.pcid;
							this.connections.set(record.id, binder);
						}
					});
					if (!binder.pc) {
						throw new Error('no binder for pc');
					}

					if (record.initiator && message.data.renegotiate) {
						// Ignore renegotiate requests when just created the pc. This avoid double offer when the
						// connection is slow.
						console.debug('p2p skipping renegotiate request for new initiator pc', pc2._id, pc2);
						break;
					}
				}

				if (message.data.noop) {
					console.debug('p2p skipping noop signal', binder.pc._id, binder.pc, record.initiator);
					break;
				}

				if (message.data && message.data.sdp && this.options.remoteSDPTransform) {
					// Remote SDP transform support.
					message.data.sdp = this.options.remoteSDPTransform(message.data.sdp, this.options.kind);
				}
				binder.pc.signal(message.data);

				break;

		}

		return binder ? binder.pc : undefined;
	}

	/**
	 * Destroys the accoicated stream reference and terminates all its connections.
	 */
	public destroy(): void {
		this.connections.forEach((binder: PCRecord): void => {
			if (binder.pc) {
				binder.pc.destroy();
				binder.pc = undefined;
			}
		});
		this.connections.clear();
		this.stream = undefined;
	}
}

/**
 * A P2PController bundles functionality for direct communication between peers via
 * a peer connections data channel Connections are registeed with the controller
 * and then automatically establish a simple JSON based protocol for extended
 * direct signaling between each other..
 */
export class P2PController {
	/**
	 * Data channel payload version. All data channel payloads will include this
	 * value and clients can use it to check if they are compatible with the
	 * received data. This client will reject all messages which are from
	 * received with older version than defined here.
	 */
	public static version = 20190225;

	public webrtc: WebRTCBaseManager;

	private connections: Map<string, P2PRecord>;
	private localStreams: Map<string, StreamRecord>;

	private callbacks: Map<string, (record: P2PRecord, message: IRTMTypeWebRTC) => SimplePeer | undefined>;

	public constructor(webrtc: WebRTCBaseManager) {
		this.webrtc = webrtc;

		this.connections = new Map<string, P2PRecord>();
		this.localStreams = new Map<string, StreamRecord>();
		this.callbacks = new Map<string, (record: P2PRecord, message: IRTMTypeWebRTC) => SimplePeer | undefined>();
	}

	/**
	 * Set the local media stream. Streams will be automatically announced to
	 * all registered peers if required.
	 *
	 * @param id Id of the stream as used in announcement.
	 * @param kind Kind of the stream as used in announcement.
	 * @param stream MediaStream object. Do not provide this parameter to no
	 *        longer announce that stream.
	 */
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
			this.callbacks.set(record.token, record.handleWebRTC);
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
			record.connections.forEach((binder: PCRecord, key: string): void => {
				// console.debug('p2p update stream', pc, key);
				// TODO(longsleep): Use replace track for certain kinds.
				if (binder.pc) {
					if (old.stream) {
						binder.pc.removeStream(old.stream);
					}
					binder.pc.addStream(stream);
				}
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

	/**
	 * Registers peer connections per user with config.
	 *
	 * @param pc Connection to register.
	 * @param user Owner user of the provided connection.
	 * @param config Configuration passed along to newly created records.
	 */
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

	/**
	 * Event handler when a peer connection has connected. To have any effect, the
	 * connection must have been registered before.
	 *
	 * @param pc Connection which triggered this event.
	 */
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

	/**
	 * Event handler when a peer connection has closed. To have any effect, the
	 * connection must have been registered before.
	 *
	 * @param pc Connection which triggered this event.
	 */
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
			record.streams.forEach((streamRecord): void => {
				streamRecord.destroy();
			});
			record.streams.clear();
		}
	}

	/**
	 * Event handler when a peer connection has received data on the data channel.
	 * To have any effect, the connection must have been registered before.
	 *
	 * @param pc Connection which triggered this event.
	 * @param data Data as received.
	 */
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

	/**
	 * Creates a new connection for the provided record with the provided options. The new
	 * connections signals are bound to the associated manager and send via data channel to
	 * the peer target provided in the record.
	 *
	 * @param record P2p record to use as peer target.
	 * @param binder Pc record which binds peer connections with remote id.
	 * @param opts RTCPeerConnection options as passed along to [[SimplePeer]].
	 * @param cb Callback function.
	 */
	public getPeerConnection(record: P2PRecord, binder: PCRecord, opts?: any, cb?: (pc: SimplePeer) => void): SimplePeer {
		const { streams, localSDPTransform, remoteSDPTransform, source, kind, ...options } = opts;

		const pc = new SimplePeer({
			config: record.config,
			initiator: record.initiator,
			objectMode: true,
			sdpTransform: (sdp: string): string => {
				if (localSDPTransform) {
					return localSDPTransform(sdp, kind);
				}
				return sdp;
			},
			trickle: true,
			...options,
		});
		const recover = (record: P2PRecord, pc: SimplePeer, delay = 500): void => {
			// To recover from error, create new pc in record and start signaling again.
			setTimeout((): void => {
				if (binder.pc !== undefined && pc !== binder.pc) {
					return;
				}
				if (!record.reconnect) {
					return;
				}

				console.debug('p2p peerconnection auto recover after error');
				pc.destroy();

				const newpc = this.getPeerConnection(record, binder, opts, cb);
				binder.rpcid = undefined;
				console.debug('created p2p pc', newpc._id, newpc, record.initiator);
				if (!record.initiator) {
					// Manually trigger noop negotiation from the peer if this
					// peer is not the initiator. This starts WebRTC with
					// the other side.
					newpc.emit('signal', {
						renegotiate: true,
						noop: true,
					});
				}
			}, delay);
		}
		pc.on('error', (err): void => {
			if (pc !== binder.pc) {
				return;
			}

			console.warn('p2p connection error', pc._id, err);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.error', record, err));

			if (!record.reconnect) {
				return;
			}
			// Clear and emit renegotiate signal.
			recover(record, pc, 500);
		});
		pc.on('signal', (data): void => {
			if (pc !== binder.pc) {
				return;
			}

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
			// console.debug('>>> p2p webrtc signal', payload);
			this.sendDatachannelPayload(payload, 0, record.pc).catch((err): void => {
				console.error('p2p peerconnection signal data channel send failed', pc._id, err);
				// Auto recovery.
				recover(record, pc, 500);
			});
		});
		pc.on('connect', (): void => {
			if (pc !== binder.pc) {
				return;
			}

			console.debug('p2p connection connect', pc._id);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.connect', record, pc));
		});
		pc.on('close', (): void => {
			if (pc !== binder.pc) {
				return;
			}

			console.debug('p2p connection close', pc._id);
			this.webrtc.dispatchEvent(new WebRTCPeerEvent(this.webrtc, 'pc.closed', record, pc));
			binder.pc = undefined;
		});
		pc.on('iceStateChange', (connectionState, gatheringState): void => {
			if (pc !== binder.pc) {
				return;
			}

			console.debug('p2p iceStateChange', pc._id, connectionState, gatheringState);
		});
		pc.on('signalingStateChange', (state): void => {
			if (pc !== binder.pc) {
				return;
			}

			console.debug('p2p signalingStateChange', pc._id, state);
		});
		if (!pc._pc.onconnectionstatechange) {
			// NOTE(longsleep): Backport https://github.com/feross/simple-peer/pull/541
			pc._pc.onconnectionstatechange = (): void => {
				if (pc.destroyed) {
					return;
				}
				console.debug('p2p peerconnection connectionstatechange', pc._id, pc._pc.connectionState);
				if (pc._pc.connectionState === 'failed') {
					const err = new Error('Connection failed.') as any;
					err.code = 'ERR_CONNECTION_FAILURE';
					pc.destroy(err);
				}
			}
		}

		// Further stuff for supported kinds.
		switch (kind) {
			case 'screenshare':
				// Screen share is special, only one direction and video only.
				console.debug('p2p screenshare connection created, preparing', pc._id);
				if (!streams) {
					if (record.initiator && 'addTransceiver' in pc) {
						pc.addTransceiver('video', {
							direction: 'recvonly',
						});
					}
				} else {
					streams.forEach((stream: MediaStream): void => {
						stream.getVideoTracks().forEach((track: MediaStreamTrack): void => {
							pc.addTrack(track, stream);
						});
					});
				}
				break;

			default:
				// Add streams as they are available.
				if (streams) {
					streams.forEach((stream: MediaStream): void => {
						pc.addStream(stream);
					});
				}
				break;
		}

		console.debug('p2p peerconnection new', pc._id, streams, kind, options, record.initiator);

		/*if (record.initiator) {
			window.destroyP2P = (): void => {
				pc.destroy(new Error('lala'));
			};
		}*/

		binder.pc = pc;

		if (cb) {
			cb(pc);
		}

		return pc;
	}

	private getConnectionID(pc: SimplePeer): string {
		return pc._id;
	}

	private announceStreams(record?: P2PRecord, force = false): void {
		const streams = Array<IP2PStreamAnnouncement>();
		this.localStreams.forEach((streamRecord: StreamRecord): void => {
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
			this.connections.forEach((p2pRecord: P2PRecord): void => {
				if (p2pRecord.ready && p2pRecord.pc && !p2pRecord.pc.destroyed) {
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

		message.streams.forEach((streamAnnouncement): void => {
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
					this.callbacks.set(streamRecord.token, streamRecord.handleWebRTC);
				}
				status.set(streamAnnouncement.id, false);
			} else {
				status.set(streamAnnouncement.id, true);
				added.push(streamAnnouncement);
			}
		});

		const removed: StreamRecord[] = [];
		streams.forEach((streamRecord): void => {
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

		added.forEach((streamAnnouncement): void => {
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

			this.callbacks.set(streamRecord.token, streamRecord.handleWebRTC);
			streams.set(id, streamRecord);

			// Create new connection for announced stream.
			const old = streamRecord.connections.get(id);
			if (old) {
				// Already have a connection.
				console.debug('p2p already have that connection, so keep it and do nothing', record.id, id);
			} else {
				console.debug('p2p start webrtc, announce received', record.id, id);
				const binder = new PCRecord()
				const pc = this.getPeerConnection(record, binder, {
					...streamRecord.options,
					source: streamAnnouncement.token, // NOTE(longsleep): Use source to pass along token.
				}, (pc: SimplePeer): void => {
					pc.on('track', (track, mediaStream): void => {
						if (pc !== binder.pc) {
							return;
						}
						this.webrtc.dispatchEvent(
							new WebRTCStreamTrackEvent(
								this.webrtc, 'pc.track', record, track, mediaStream, streamRecord.token),
						);
					});
					streamRecord.connections.set(record.id, binder);
				});
				if (!record.initiator) {
					// Since we are not marked as initiator, let other side know
					// that we are ready to start webrtc.
					pc.emit('signal', {
						renegotiate: true,
						noop: true,
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
		// console.debug('<<< p2p webrtc signal', message);
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
		replyTimeout = 0,
		pc: SimplePeer): Promise<IRTMTypeEnvelope> {
		return new Promise<IRTMTypeEnvelope>((resolve, reject): void => {
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
