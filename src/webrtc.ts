/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import * as SimplePeer from 'simple-peer';
import {
	KWMErrorEvent,
	WebRTCAnnounceStreamsEvent,
	WebRTCPeerEvent,
	WebRTCStreamEvent,
	WebRTCStreamTrackEvent,
} from './events';
import { GroupController } from './group';
import { P2PController } from './p2p';
import { IRTMDataProfile, IRTMDataWebRTCChannelExtra, IRTMTypeEnvelope, IRTMTypeError, IRTMTypeHello,
	IRTMTypeWebRTC } from './rtm';
import { getRandomString } from './utils';

/**
 * A PeerRecord represents a current or future peer connection with additional
 * meta data.
 */
export class PeerRecord {
	public id: string = '';
	public profile?: IRTMDataProfile;
	public extra?: any;
	public group?: string = '';
	public hash: string = '';
	public initiator: boolean = false;
	public reconnect: boolean = true;
	public pc?: SimplePeer;
	public ref: string = '';
	public state: string = '';
	public user: string = '';
	public cid: string = '';
	public transaction?: string = '';
	public rpcid?: string;
}

/**
 * A WebRTCOptions represents the various options which can be used with
 * the [[WebRTCManager]].
 */
export class WebRTCOptions {
	public channelConfig?: RTCDataChannelInit;
	public channelName?: string;
	public offerConstraints?: RTCOfferOptions;
	public answerConstraints?: RTCAnswerOptions;
	public localSDPTransform?: (sdp: string) => string;
	public remoteSDPTransform?: (sdp: string) => string;
}

/**
 * ChannelOptions bind [[PeerRecord]]s to channels.
 */
export class ChannelOptions {
	public localStreamTarget?: PeerRecord;
}

/**
 * A IWebRTCManagerContainer is a container which connects WebRTCManagers with
 * the ouside world.
 */
export interface IWebRTCManagerContainer {
	sendWebSocketPayload(payload: IRTMTypeEnvelope, replyTimeout?: number, record?: PeerRecord): Promise<IRTMTypeEnvelope>;
}

/**
 * A WebRTCBaseManager bundles all WebRTC related client functionality and keeps
 * track of individual peer states via [[WebRTCManager]].
 */
export class WebRTCBaseManager {
	/**
	 * WebRTC payload version. All WebRTC payloads will include this value and
	 * clients can use it to check if they are compatible with the received
	 * data. This client will reject all messages which are from received with
	 * older version than defined here. Also the server might reject messages
	 * for versions deemed too old.
	 */
	public static version = 20180703;

	/**
	 * WebRTC PeerConnection config for all connections created by
	 * [[WebRTCManager.getPeerConnection]]. Overwrite as needed.
	 */
	public config: any = {
		iceServers: [
			{url: 'stun:stun.l.google.com:19302'},
		],
		sdpSemantics: 'plan-b', // For now use Plan-B by default. See https://webrtc.org/web-apis/chrome/unified-plan/.
	};
	/**
	 * WebRTC PeerConnection options for all connections created by
	 * [[WebRTCManager.getPeerConnection]]. Set as needed.
	 */
	public options: WebRTCOptions = {
	};
	/**
	 * Event handler for [[WebRTCPeerEvent]]. Set to a function to get called
	 * whenever [[WebRTCPeerEvent]]s are triggered.
	 */
	public onpeer?: (event: WebRTCPeerEvent) => void;
	/**
	 * Event handler for [[WebRTCStreamEvent]]. Set to a function to get called
	 * whenever [[WebRTCStreamEvent]]s are triggered.
	 */
	public onstream?: (event: WebRTCStreamEvent) => void;
	/**
	 * Event handler for [[WebRTCStreamTrackEvent]]. Set to a function to get called
	 * whenever [[WebRTCStreamTrackEvent]]s are triggered.
	 */
	public ontrack?: (event: WebRTCStreamTrackEvent) => void;
	/**
	 * Event handler for [[WebRTCAnnounceStreamsEvent]]. Set to a function to
	 * get called whenever [[WebRTCAnnounceStreamsEvent]]s are triggered.
	 */
	public onannouncestreams?: (event: WebRTCAnnounceStreamsEvent) => void;

	protected kwm: IWebRTCManagerContainer;
	protected p2p: P2PController;

	protected localStream?: MediaStream;
	protected user?: string;
	protected channel: string = '';
	protected channelOptions: ChannelOptions = {};
	protected group?: GroupController;
	protected peers: Map<string, PeerRecord>;

	/**
	 * Creates WebRTCManager instance bound to the provided [[KWM]].
	 *
	 * @param container Reference to a IWebRTCManagerContainer instance.
	 */
	public constructor(kwm: IWebRTCManagerContainer) {
		this.kwm = kwm;
		this.p2p = new P2PController(this);
		this.peers = new Map<string, PeerRecord>();
	}

	/**
	 * Generic event dispatcher. Dispatches callback functions based on event
	 * types. Throws error for unknown event types. If a known event type has no
	 * event handler registered, dispatchEvent does nothing.
	 *
	 * @param event Event to be dispatched.
	 * @param async Boolean value if the event should trigger asynchronously.
	 */
	public dispatchEvent(event: any, async?: boolean): void {
		if (async) {
			setTimeout(() => {
				this.dispatchEvent(event, false);
			}, 0);
			return;
		}

		switch (event.constructor.getName()) {
			case WebRTCPeerEvent.getName():
				if (this.onpeer) {
					this.onpeer(event);
				}
				break;
			case WebRTCStreamEvent.getName():
				if (this.onstream) {
					this.onstream(event);
				}
				break;
			case WebRTCStreamTrackEvent.getName():
				if (this.ontrack) {
					this.ontrack(event);
				}
				break;
			case WebRTCAnnounceStreamsEvent.getName():
				if (this.onannouncestreams) {
					this.onannouncestreams(event);
				}
				break;
			default:
				throw new Error('unknown event: ' + event.constructor.getName());
		}
	}

	protected setChannelOptions(options: ChannelOptions): ChannelOptions {
		Object.assign(this.channelOptions, options);
		return this.channelOptions;
	}

	protected getPeerConnection(initiator: boolean, record: PeerRecord, rpcid?: string): SimplePeer {
		const { localSDPTransform, remoteSDPTransform, ...options } = this.options;

		const streams = [];
		if (this.isLocalStreamTarget(record) && this.localStream) {
			streams.push(this.localStream);
		}
		const pc = new SimplePeer({
			channelName: 'kwmjs-1',
			config: this.config,
			initiator,
			objectMode: true,
			sdpTransform: localSDPTransform,
			streams,
			trickle: true,
			...options,
		});
		const recover = (initiator: boolean, record: PeerRecord, pc: SimplePeer | undefined, delay: number = 500): void => {
			// To recover from error, create new pc in record and start signaling again.
			setTimeout((): void => {
				if (record.pc !== undefined && pc !== record.pc) {
					return;
				}
				if (!record.reconnect) {
					return;
				}

				console.debug('peerconnection auto reconnect after error');
				if (record.pc) {
					record.pc.destroy();
				}
				// NOTE(longsleep): Possible race when both sides errored.
				const newpc = this.getPeerConnection(initiator, record, undefined);
				console.debug('created pc', newpc._id, newpc, initiator);
				if (!initiator) {
					// Manually trigger negotiation from the peer if this
					// peer is not the initiator. This starts WebRTC with
					// the other side.
					newpc.emit('signal', {
						renegotiate: true,
					});
				}
			}, delay);
		}
		pc.on('error', (err): void => {
			if (pc !== record.pc) {
				return;
			}

			console.debug('peerconnection error', pc._id, err);
			this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.error', record, err));

			if (!record.reconnect) {
				return;
			}
			// Auto recovery.
			recover(initiator, record, record.pc, 500);
		});
		pc.on('signal', (data): void => {
			if (pc !== record.pc) {
				return;
			}

			// console.debug('peerconnection signal', pc._id, data);
			const payload = {
				channel: this.channel,
				data,
				group: record.group,
				hash: record.hash,
				id: 0,
				pcid: pc._id,
				state: record.state,
				subtype: 'webrtc_signal',
				target: record.user,
				type: 'webrtc',
				v: WebRTCManager.version, // eslint-disable-line @typescript-eslint/no-use-before-define
			};
			// console.debug('>>> send signal', payload);
			this.kwm.sendWebSocketPayload(payload, undefined, record).catch((err): void => {
				console.error('peerconnection signal websocket send failed', pc._id, err);
				// Auto recovery.
				recover(initiator, record, record.pc, 500);
			});
		});
		pc.on('connect', (): void => {
			if (pc !== record.pc) {
				return;
			}

			console.debug('peerconnection connect', pc._id);
			this.p2p.handleConnect(pc);
			this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.connect', record, pc));
		});
		pc.on('close', (): void => {
			if (pc !== record.pc) {
				return;
			}

			console.log('peerconnection close', pc._id);
			this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.closed', record, pc));
			this.p2p.handleClose(pc);
			record.pc = undefined;
		});
		pc.on('track', (track, mediaStream): void => {
			if (pc !== record.pc) {
				return;
			}

			console.debug('peerconnection track', pc._id, track, mediaStream);
			this.dispatchEvent(new WebRTCStreamTrackEvent(this, 'pc.track', record, track, mediaStream));
		});
		pc.on('stream', (mediaStream): void => {
			if (pc !== record.pc) {
				return;
			}

			// console.debug('peerconnection stream', pc._id, mediaStream);
			this.dispatchEvent(new WebRTCStreamEvent(this, 'pc.stream', record, mediaStream));
		});
		pc.on('data', (data): void => {
			if (pc !== record.pc) {
				return;
			}

			this.p2p.handleData(pc, data);
		});
		pc.on('iceStateChange', (state): void => {
			if (pc !== record.pc) {
				return;
			}

			console.debug('iceStateChange', pc._id, state);
			this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.iceStateChange', record, state));
		});
		pc.on('signalingStateChange', (state): void => {
			if (pc !== record.pc) {
				return;
			}

			console.debug('signalingStateChange', pc._id, state);
			this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.signalingStateChange', record, state));
		});

		record.pc = pc;
		record.rpcid = rpcid;

		console.debug('peerconnection new', pc._id);
		this.p2p.registerConnection(pc, record.user, this.config);
		this.dispatchEvent(new WebRTCPeerEvent(this, 'pc.new', record, pc));

		return pc;
	}

	/**
	 * Compute wether or not the provided record is the target which should
	 * be used for local streams for the accociated manager. If the local
	 * stream target is not set, all records are local stream target.
	 */
	protected isLocalStreamTarget(record: PeerRecord): boolean {
		const { localStreamTarget } = this.channelOptions;

		return !localStreamTarget || localStreamTarget === record;
	}
}

/**
 * A WebRTCManager bundles all WebRTC action for client side calling.
 */
export class WebRTCManager extends WebRTCBaseManager {
	/**
	 * Triggers a WebRTC call request via RTM to the provided user.
	 *
	 * @param user The User ID to call. Must not exist in the accociated
	 *        [[[[WebRTCManager]].
	 * @returns Promise providing the channel ID assigned to the new call.
	 */
	public async doCall(user: string): Promise<string> {
		console.debug('webrtc doCall', user);

		if (this.channel) {
			throw new Error('already have a channel');
		}
		if (this.peers.has(user)) {
			throw new Error('peer already exists');
		}

		const record = new PeerRecord();
		record.id = user;
		record.initiator = true;
		record.user = user;
		record.state = getRandomString(12);
		this.peers.set(record.id, record);

		const event = new WebRTCPeerEvent(this, 'newcall', record);
		this.dispatchEvent(event);

		const reply = await this.sendWebrtc('webrtc_call', '', record, undefined, 5000) as IRTMTypeWebRTC;
		if (record !== this.peers.get(user)) {
			throw new Error('unknown or invalid peer');
		}
		if (record.hash) {
			throw new Error('record already has a hash');
		}

		this.handleReplyMessage(reply, () => {
			record.hash = reply.hash;
		});

		return this.channel;
	}

	/**
	 * Triggers a WebRTC call request via RTM to the provided user to answer
	 * and accept a previously received peer.
	 *
	 * @param user The User ID of the peer to answer. Must exist in the
	 *        accociated [[WebRTCManager.peers]].
	 * @returns Promise providing the channel ID assigned to the call.
	 */
	public async doAnswer(user: string): Promise<string> {
		console.debug('webrtc doAnswer', user);

		if (!this.channel) {
			throw new Error('no channel');
		}

		const record = this.peers.get(user);
		if (!record) {
			throw new Error('no matching peer');
		}

		const event = new WebRTCPeerEvent(this, 'newcall', record);
		event.channel = this.channel;
		this.dispatchEvent(event);

		await this.sendWebrtc('webrtc_call', this.channel, record, {
			accept: true,
			state: record.ref,
		}, 0, record.transaction || '');
		record.transaction = '';
		if (record !== this.peers.get(user)) {
			throw new Error('unknown or invalid peer');
		}

		return this.channel;
	}

	/**
	 * Rejects a WebRTC call request via RTM to the provided user with the
	 * provided reason.
	 *
	 * @param user The User ID of the peer to reject.
	 * @param reason The reason sent to the peer why reject was sent.
	 * @returns Promise providing the accociated channel ID.
	 */
	public async doReject(user: string, reason: string = 'reject'): Promise<string> {
		console.debug('webrtc doReject', user, reason);

		if (!this.channel) {
			throw new Error('no channel');
		}

		const record = this.peers.get(user);
		if (!record) {
			throw new Error('no matching peer');
		}

		const channel = this.channel;

		this.sendWebrtc('webrtc_call', this.channel, record, {
			accept: false,
			reason,
			state: record.ref,
		}, 0, record.transaction || '');
		record.transaction = '';

		// Hangup with out a reason is local.
		this.sendHangup(this.channel, record, '');

		return channel;
	}

	/**
	 * Triggers group joining request via RTM to the provided group.
	 *
	 * @param group The group ID of the group to join.
	 *
	 * @returns Promise providing the channel ID assigned for this group.
	 */
	public async doGroup(group: string): Promise<string> {
		console.debug('webrtc doGroup', group);

		if (this.channel) {
			throw new Error('already have a channel');
		}
		if (this.group) {
			throw new Error('already have a group');
		}

		// Create group record.
		const record = new PeerRecord();
		record.user = group;
		record.group = group;
		record.state = getRandomString(12);

		const reply = await this.sendWebrtc('webrtc_group', '', record, undefined, 5000) as IRTMTypeWebRTC;

		// Set hash with value from server.
		record.hash = reply.hash;

		if (!this.channel && !this.group) {
			this.handleReplyMessage(reply, () => {
				this.group = new GroupController(this, group, record);
			});
		}

		return this.channel;
	}

	/**
	 * Triggers a WebRTC hangup request via RTM to the provided user ID. If no
	 * user ID is given all calls will be hung up and the accociated channel
	 * will be cleared.
	 *
	 * @param user The User ID of the peer to hangup. Must exist in the
	 *        accociated [[WebRTCManager.peers]]. If empty, all known peers will
	 *        be sent hangup requests.
	 * @returns Promise providing the accociated channel ID.
	 */
	public async doHangup(user: string = '', reason: string = 'hangup'): Promise<string> {
		console.log('webrtc doHangup', user, reason);

		const channel = this.channel;
		const group = this.group;
		if (!user) {
			// Hangup all.
			this.channel = '';
			this.channelOptions = {};
			this.group = undefined;
			if (group) {
				this.sendHangup(channel, group.record, reason);
			}
			this.peers.forEach((record: PeerRecord, key: string, peers: Map<string, PeerRecord>) => {
				this.sendHangup(channel, record, reason);
			});
		} else {
			const record = this.peers.get(user);
			if (!record) {
				throw new Error('unknown peer');
			}
			this.sendHangup(this.channel, record, reason);
		}

		return channel;
	}

	/**
	 * Triggers a WebRTC full mesh group call to the provided ids using the
	 * provided group record..
	 *
	 * @param users The Users ID of the peers to connect.
	 * @param groupRecord peer record of the accociated group.
	 *
	 * @returns Promise providing the accociated channel ID.
	 */
	public async doMesh(users: string[], groupRecord: PeerRecord): Promise<string> {
		console.log('webrtc doMesh', this.user, users);
		if (!this.user) {
			throw new Error('no user');
		}

		const channel = this.channel;
		if (!channel) {
			throw new Error('no channel');
		}

		const added: string[] = [];
		const removed: string[] = [];
		const ourselves = this.user;
		const peers = this.peers;
		const all = new Map<string, boolean>();

		// Find new required peers.
		let ok = false;
		for (const user of users) {
			if (user === ourselves) {
				// Ignore ourselves but set OK.
				ok = true;
				continue;
			}
			all.set(user, true);
			if (!peers.has(user)) {
				added.push(user);
			}
		}
		if (!ok) {
			throw new Error('mesh without self');
		}

		// Find obsolete peers which we have but no longer in group.
		peers.forEach((record): void => {
			if (record.cid !== '') {
				// Normal peers only for mesh.
				return;
			}
			if (!all.has(record.user)) {
				removed.push(record.user);
			} else if (!record.pc || record.pc.destroyed) {
				// Bring back dead connections.
				added.push(record.user);
			}
		});

		console.log('webrtc doMesh triggers', added, removed, all);

		const promises: Promise<string>[] = [];

		// Remove first.
		for (const user of removed) {
			promises.push(this.doHangup(user, '')); // NOTE(longsleep): Hangup without reason is a local hangup.
		}

		// Add second.
		for (const user of added) {
			const record = new PeerRecord();
			record.id = user;
			record.user = user;
			record.group = groupRecord.group;
			// TODO(longsleep): Hash and refs are from the group here - find a
			// better way to make those peer match specific.
			record.hash = groupRecord.hash;
			record.ref = groupRecord.group || '';
			record.state = groupRecord.group || '';
			this.peers.set(record.id, record);

			console.log('webrtc doMesh outbound', user, record.ref, record.hash);
			promises.push(this.doAnswer(user).catch(err => {
				console.warn('webrtc doMesh failed to answer outbound', err, user, record.ref, record.hash);
				return '';
			}));
		}

		// Wait on all.
		return Promise.all(promises).then(() => {
			return channel;
		});
	}

	/**
	 * Set the local media stream. That stream will be attached to all new
	 * Peers which are created afterwards and added to all existing Peers
	 * directly. If there was a stream previously attached, then that stream
	 * is removed from all existing Peers before the new stream is added.
	 *
	 * @param stream MediaStream object. Do not provide this parameter to no
	 *        longer use a local stream and to remove it from existing Peers.
	 */
	public setLocalStream(stream?: MediaStream): void {
		if (this.localStream === stream) {
			return;
		}

		// Remember old stream for cleanup.
		const oldStream = this.localStream;
		// Update local stream for new Peers early.
		this.localStream = stream;

		// Update established peers as well.
		const channelOptions = this.channelOptions;
		this.peers.forEach((peer: PeerRecord) => {
			if (this.isLocalStreamTarget(peer) && peer.pc) {
				if (oldStream) {
					// NOTE(longsleep): This internally uses removeTracks - no need to do that ourselves.
					peer.pc.removeStream(oldStream);
				}
				if (stream) {
					// NOTE(longsleep): This internally uses addTracks  - no need to do that ourselves.
					peer.pc.addStream(stream);
				}
			}
		});
	}

	/**
	 * Set the local screen share stream with id as p2p stream.
	 *
	 * @param id ID of the stream.
	 * @param stream MediaStream object. Do not provide this parameter to remove
	 *               a previously stream.
	 */
	public setScreenshareStream(id: string, stream?: MediaStream): void {
		this.p2p.setLocalStream(id, 'screenshare', stream);
	}

	/**
	 * Add a track from the local media stream to all existing Peers. Use this
	 * function to trigger renegotiation after a track was added to the local
	 * stream.
	 */
	public addLocalStreamTrack(track: MediaStreamTrack, stream: MediaStream): void {
		if (this.localStream !== stream) {
			throw new Error('wrong stream');
		}

		this.peers.forEach((peer: PeerRecord) => {
			if (peer.pc) {
				peer.pc.addTrack(track, stream);
			}
		});
	}

	/**
	 * Remove a track of the local media stream from all existing Peers. Use
	 * this to trigger renegotiation after a track was removed from the stream.
	 */
	public removeLocalStreamTrack(track: MediaStreamTrack, stream: MediaStream): void {
		if (this.localStream !== stream) {
			throw new Error('wrong stream');
		}

		this.peers.forEach((peer: PeerRecord) => {
			if (peer.pc) {
				// NOTE(longsleep): This will destroy the peer connection if the
				// track was not previously added.
				peer.pc.removeTrack(track, stream);
				if (peer.pc) {
					peer.pc._needsNegotiation();
				}
			}
		});
	}

	/**
	 * Mute first track of the accociated local video or audio stream.
	 * @param video If true, control first video track, else first audio track.
	 * @param mute flag to enable/disable first track.
	 * @returns true when matching track was found, false otherwise.
	 */
	public mute(video: boolean, mute: boolean): boolean {
		if (!this.localStream) {
			return false;
		}

		let firstTrack: MediaStreamTrack;
		if (video) {
			if (!this.localStream.getVideoTracks()) {
				return false;
			}
			firstTrack = this.localStream.getVideoTracks()[0];
		} else {
			if (!this.localStream.getAudioTracks()) {
				return false;
			}
			firstTrack = this.localStream.getAudioTracks()[0];
		}

		if (!firstTrack) {
			return false;
		}
		firstTrack.enabled = !mute;

		return true;
	}

	/**
	 * Process incoming hello message. Basically sets our own user.
	 *
	 * @private
	 * @param user User id.
	 */
	public handleHello(hello: IRTMTypeHello, user?: string): void {
		const id = hello.self ? hello.self.id : undefined;
		if (!id && !user) {
			throw new Error('hello without self - kwm server too old?');
		}
		user = id ? id : user; // NOTE(longsleep): Backwards compatibility.

		if (this.user && this.channel && user !== this.user) {
			console.warn('webrtc user changed, hangup', this.user, user);
			this.doHangup();
		}

		this.user = user;

		if (user && this.group && this.group.hasMember(user)) {
			this.refreshGroup(this.group);
		}
	}

	/**
	 * Process incoming KRM RTM API WebRTC reply payload data.
	 *
	 * @private
	 * @param message Payload message.
	 */
	public handleReplyMessage(message: IRTMTypeEnvelope, successCb?: () => void): void {
		if (message.type === 'error')  {
			console.warn('server reply error', message);
			throw new KWMErrorEvent(this, (message as IRTMTypeError).error);
		}

		if (successCb) {
			successCb();
		}

		switch (message.type) {
			case 'webrtc':
				this.handleWebRTCMessage(message as IRTMTypeWebRTC);
				break;

			default:
				console.debug('unknown reply type', message.type, message);
				break;
		}
	}

	/**
	 * Process incoming KWM RTM API WebRTC related payload data.
	 *
	 * @private
	 * @param message Payload message.
	 */
	public handleWebRTCMessage(message: IRTMTypeWebRTC): void {
		// console.debug('<<< webrtc', message);
		let record: PeerRecord;

		if (!message.v || message.v < WebRTCManager.version) {
			console.log('webrtc ignoring message with outdated version', message.v, message);
			return;
		}

		switch (message.subtype) {
			case 'webrtc_call':
				if (message.initiator) {
					if (!message.source) {
						console.warn('webrtc incoming call without source');
						return;
					}

					record = this.peers.get(message.source) as PeerRecord;
					if (record) {
						if (!message.target) {
							// Silent clear incoming call, call was taken by other connection.
							setTimeout(() => {
								this.sendHangup(message.channel, record, ''); // NOTE(longsleep): Hangup without reason is a local hangup.
							}, 0);
							return;
						}

						// TODO(longsleep): Figure out what we do in this case. For now let
						// it pass and rely on the busy handling below.
						console.warn('webrtc incoming call while already have that peer', message.source);
					}

					// Incoming call.
					record = new PeerRecord();
					record.id = message.source;
					record.profile = message.profile;
					record.user = message.source;
					record.state = getRandomString(12);
					record.ref = message.state;
					record.hash = message.hash;
					record.transaction = message.transaction || '';

					if (this.channel) {
						// busy
						console.warn('webrtc incoming call while already have a call', this.channel);
						// TODO(longsleep): Add general reply to server for calls to get busy
						// handling right.
						this.sendWebrtc('webrtc_call', message.channel, record, {
							accept: false,
							reason: 'reject_busy',
							state: record.ref,
						}, 0, record.transaction || '').catch(err => {
							console.error('webrtc failed to reject busy', this.channel, err);
						});
						return;
					}
					if (this.channel && this.channel !== message.channel) {
						console.debug('webrtc incoming call with wrong channel', this.channel);
						return;
					}

					if (message.data) {
						this.handleWebRTCExtraChannelData(message);
					}

					this.channel = message.channel;
					this.peers.set(record.id, record);

					const event = new WebRTCPeerEvent(this, 'incomingcall', record);
					event.channel = message.channel;
					this.dispatchEvent(event, true);

				} else {
					// check and start webrtc.
					record = this.peers.get(message.source) as PeerRecord;
					if (!record) {
						console.warn('webrtc unknown peer', message.source);
						return;
					}
					if (record.state !== message.data.state) {
						console.warn('webbrtc peer data with wrong state', record.state);
						return;
					}
					if (record.hash !== message.hash) {
						if (
							this.group
							&& record.group
							&& message.group
							&& record.group === message.group
							&& record.group === this.group.id
							&& message.data.accept
						) {
							console.debug('webrtc hash exchange peer record group hash', record.group);
							record.hash = message.hash;
						} else {
							console.warn('webrtc peer data with wrong hash', record.hash, message.hash, message, record);
							return;
						}
					}
					if (!message.data.accept) {
						// TODO(longsleep): Multiple answer support - this currently aborts
						// calls on the first busy signal. Most likely this is best
						// to be implemented on the server side though.
						console.debug('webrtc peer did not accept call', message);
						const abortEvent = new WebRTCPeerEvent(this, 'abortcall', record, message.data.reason || 'no reason given');
						abortEvent.channel = this.channel;
						this.dispatchEvent(abortEvent, true);
						return;
					}

					record.ref = message.state;
					record.profile = message.profile;
					console.log('start webrtc, accept call reply');

					const initiator = this.computeInitiator(record);
					const pc1 = this.getPeerConnection(initiator, record, undefined);
					console.debug('created pc', pc1._id, pc1, initiator);
					if (!initiator) {
						// Manually trigger negotiation from the peer if this
						// peer is not the initiator. This starts WebRTC with
						// the other side.
						pc1.emit('signal', {
							renegotiate: true,
						});
					}

					const event = new WebRTCPeerEvent(this, 'outgoingcall', record);
					event.channel = this.channel;
					this.dispatchEvent(event, true);
				}
				break;

			case 'webrtc_channel':
				if (this.channel && message.data === undefined) {
					console.warn('webrtc channel when already have one', this.channel, message.channel);
					return;
				}

				this.channel = message.channel;

				if (message.data) {
					this.handleWebRTCExtraChannelData(message);
				}

				break;

			case 'webrtc_hangup': {
				if (!message.channel || this.channel !== message.channel) {
					console.debug('webrtc hangup with wrong channel', this.channel, message.channel);
					return;
				}
				if (!message.data) {
					console.warn('webrtc hangup data empty');
					return;
				}

				record = this.peers.get(message.source) as PeerRecord;
				if (!record) {
					console.warn('webrtc hangup for unknown peer');
					return;
				}
				if (record.ref !== message.state && record.ref) {
					console.warn('webrtc hangup with wrong state', record.ref);
					return;
				}
				this.sendHangup(this.channel, record, ''); // NOTE(longsleep): Hangup without reason is a local hangup.

				const event = new WebRTCPeerEvent(this, 'hangup', record, message.data);
				event.channel = message.channel;
				this.dispatchEvent(event, true);

				break;
			}

			case 'webrtc_signal':
				if (!message.channel || this.channel !== message.channel) {
					console.debug('webrtc signal with wrong channel', this.channel, message.channel);
					return;
				}
				if (!message.data) {
					console.warn('webrtc signal data empty');
					return;
				}

				record = this.peers.get(message.source) as PeerRecord;
				if (!record) {
					console.warn('webrtc signal for unknown peer', message.source, this.peers);
					return;
				}
				if (record.ref !== message.state && record.ref) {
					console.warn('webrtc signal with wrong state', record.ref, message.state);
					return;
				}

				if (message.pcid !== record.rpcid) {
					if (record.rpcid === undefined) {
						if (record.pc && message.pcid !== undefined) {
							// Not bound yet, accept and bind incoming id.
							record.rpcid = message.pcid;
							console.log('bound webrtc, received signal', message.pcid, record.pc._id);
						}
					} else {
						// Existing connection but other remote pcid. What now?
						console.info('webrtc signal with new pcid', record.rpcid, message.pcid);
						if (record.pc) {
							// Kill off existing pc cleanly to start fresh on both sides.
							record.pc.destroy();
							record.pc = undefined;
						}
					}
				}

				if (!record.pc) {
					console.log('start webrtc, received signal', message.pcid);
					const pc2 = this.getPeerConnection(this.computeInitiator(record), record, message.pcid);
					console.debug('created pc', pc2._id, pc2);
					if (!record.pc) {
						throw new Error('no peer connection in record');
					}
				}

				if (message.data && message.data.sdp && this.options.remoteSDPTransform) {
					// Remote SDP transform support.
					message.data.sdp = this.options.remoteSDPTransform(message.data.sdp);
				}
				record.pc.signal(message.data);

				break;
		}
	}

	/**
	 * Process incoming KWM RTM API WebRTC extra channel data.
	 *
	 * @private
	 * @param message Payload message.
	 */
	public handleWebRTCExtraChannelData(message: IRTMTypeWebRTC): void {
		console.debug('<<< webrtc extra channel data', message);

		const data = message.data as IRTMDataWebRTCChannelExtra;
		if (!data) {
			return;
		}

		// Check for replace flag.
		if (data.replaced) {
			// Silent hangup call, it was replaced.
			setTimeout(() => {
				this.doHangup(undefined, ''); // NOTE(longsleep): Hangup without reason is a local hangup.
			}, 0);
			return;
		}

		// Process group data.
		if (data.group && this.group) {
			// Delegate to group controller.
			this.group.handleWebRTCMessage(message);
		}

		// Process pipeline data.
		const pipeline = data.pipeline;
		if (pipeline && pipeline.mode) {
			switch (pipeline.mode) {
				case 'mcu-forward':
					if (this.group) {
						// NOTE(longsleep): Enable new Peer for pipeline. This
						// peer will be used to send local streams to the
						// pipeline.
						if (!this.peers.has(pipeline.pipeline)) {
							const record = new PeerRecord();
							record.id = pipeline.pipeline;
							record.user = pipeline.pipeline;
							record.state = getRandomString(12);
							record.ref = pipeline.pipeline;
							record.hash = this.group.record.hash;
							record.cid = pipeline.mode;
							this.setChannelOptions({
								localStreamTarget: record,
							});
							this.peers.set(record.id, record);
							console.debug('webrtc pipeline peer enabled', record.ref);
						}
					}
					break;

				default:
					console.warn('webrtc channel with unknown pipeline mode', pipeline.mode);
					break;
			}
		}
	}

	protected async refreshGroup(group: GroupController): Promise<string> {
		if (!this.group || group !== this.group) {
			throw new Error('invalid group');
		}

		// Update group record.
		const record = group.record;
		record.state = getRandomString(12);

		const reply = await this.sendWebrtc('webrtc_group', '', record, undefined, 5000) as IRTMTypeWebRTC;

		// Refresh hash with value from server.
		record.hash = reply.hash;

		if (this.channel === group.channel && group.channel === reply.channel) {
			this.handleReplyMessage(reply, () => {
				this.group = group;
			});
		}

		return this.channel;
	}

	protected async sendHangup(channel: string, record: PeerRecord, reason: string = 'hangup'): Promise<boolean> {
		this.peers.delete(record.id);
		if (record.pc) {
			record.pc.destroy();
			record.pc = undefined;
		}

		const event = new WebRTCPeerEvent(this, 'destroycall', record);
		event.channel = channel;
		this.dispatchEvent(event);

		if (reason) {
			return this.sendWebrtc('webrtc_hangup', channel, record, {
				accept: false,
				reason,
				state: record.ref,
			}).then(() => {
				return Promise.resolve(true);
			}).catch(err => {
				console.error('failed to send hangup signal', channel, err);
				return Promise.resolve(true);
			});
		} else {
			return Promise.resolve(true);
		}
	}

	protected async sendWebrtc(
		subtype: string, channel: string, record: PeerRecord,
		data?: any, replyTimeout: number = 0, transaction: string = ''): Promise<IRTMTypeEnvelope> {
		const payload = {
			channel,
			data,
			group: record.group || '',
			hash: record.hash,
			id: 0,
			initiator: !!record.initiator,
			state: record.state,
			subtype,
			target: record.user,
			transaction,
			type: 'webrtc',
			v: WebRTCManager.version,
		};

		return this.kwm.sendWebSocketPayload(payload,  replyTimeout, record);
	}

	/**
	 * Compute intiiator flag based on the accociated user id compared to the
	 * provided user id.
	 *
	 * @param id User Id to be compared.
	 */
	protected computeInitiator(record: PeerRecord): boolean {
		const user = this.user;

		if (!user) {
			return false;
		}

		return user < record.user ? false : true;
	}
}
