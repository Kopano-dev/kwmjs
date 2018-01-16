/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import { KWM } from './kwm';
import { PeerRecord } from './webrtc';

export class BaseEvent {
	public static eventName = 'BaseEvent';
	public static getName(): string {
		return this.eventName;
	}

	public target: any;

	constructor(target: any) {
		this.target = target;
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
	public channel: string;
	public record: PeerRecord;
	public details: any;

	constructor(target: any, event: string, record: PeerRecord, details?: any) {
		super(target);
		this.event = event;
		this.record = record;
		this.details = details;
	}
}

export class WebRTCStreamEvent extends WebRTCPeerEvent {
	public static eventName = 'WebRTCStreamEvent';

	public stream: MediaStream;

	constructor(target: any, event: string, record: PeerRecord, stream: MediaStream) {
		super(target, event, record);
		this.stream = stream;
	}
}
