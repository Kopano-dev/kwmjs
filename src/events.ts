/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import * as SimplePeer from 'simple-peer';

import { IRTMDataProfile } from './rtm';

export interface IPeerRecord {
	user: string;
	pc?: SimplePeer;
	profile?: IRTMDataProfile;
}

export interface IP2PAnnouncement {
	id: string;
	kind: string;
	token: string;
}

export class BaseEvent {
	public static eventName = 'BaseEvent';
	public static getName(): string {
		return this.eventName;
	}

	public target: any;
	public defaultPrevented: boolean = false;

	constructor(target: any) {
		this.target = target;
	}

	public preventDefault(): void {
		this.defaultPrevented = true;
	}
}

export class KWMStateChangedEvent extends BaseEvent {
	public static eventName = 'KWMStateChangedEvent';

	public connecting: boolean;
	public connected: boolean;
	public reconnecting: boolean;

	constructor(target: any) {
		super(target);

		this.connecting = target.connecting;
		this.connected = target.connected;
		this.reconnecting = target.reconnecting;
	}
}

export class KWMTURNServerChangedEvent extends BaseEvent {
	public static eventName = 'KWMTURNServerChangedEvent';

	public ttl: number;
	public iceServer: RTCIceServer;

	constructor(target: any, ttl: number, iceServer: RTCIceServer) {
		super(target);

		this.ttl = ttl;
		this.iceServer = iceServer;
	}
}

export class KWMErrorEvent extends BaseEvent {
	public static eventName = 'KWMErrorEvent';

	public code: string;
	public msg: string;

	constructor(target: any, details: any) {
		super(target);

		this.code = details.code;
		this.msg = details.msg;
	}
}

export class WebRTCPeerEvent extends BaseEvent {
	public static eventName = 'WebRTCPeerEvent';

	public event: string;
	public channel: string = '';
	public record: IPeerRecord;
	public details: any;

	constructor(target: any, event: string, record: IPeerRecord, details?: any) {
		super(target);
		this.event = event;
		this.record = record;
		this.details = details;
	}
}

export class WebRTCStreamEvent extends WebRTCPeerEvent {
	public static eventName = 'WebRTCStreamEvent';

	public stream: MediaStream;
	public token: string;

	constructor(target: any, event: string, record: IPeerRecord, stream: MediaStream, token: string = '') {
		super(target, event, record);
		this.stream = stream;
		this.token = token;
	}
}

export class WebRTCStreamTrackEvent extends WebRTCPeerEvent {
	public static eventName = 'WebRTCStreamTrackEvent';

	public track: MediaStreamTrack;
	public stream: MediaStream;
	public token: string;

	constructor(
		target: any, event: string, record: IPeerRecord, track: MediaStreamTrack, stream: MediaStream,
		token: string = '') {
		super(target, event, record);
		this.track = track;
		this.stream = stream;
		this.token = token;
	}
}

export class WebRTCAnnounceStreamsEvent extends WebRTCPeerEvent {
	public static eventName = 'WebRTCAnnounceStreamsEvent';

	public added: IP2PAnnouncement[];
	public removed: IP2PAnnouncement[];

	constructor(
		target: any, event: string, record: IPeerRecord, added: IP2PAnnouncement[],
		removed: IP2PAnnouncement[]) {
		super(target, event, record);
		this.added = added;
		this.removed = removed;
	}
}
