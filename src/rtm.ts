/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

export interface IRTMConnectResponse {
	url?: string;
	ok: boolean;
	error: IRTMDataError;

	turn?: ITURNConfig;
}

export interface IRTMTURNResponse {
	ok: boolean;
	error: IRTMDataError;

	turn: ITURNConfig;
}

export interface ITURNConfig {
	username: string;
	password: string;
	ttl: number;
	uris: string[];
}

export interface IRTMDataError {
	code: string;
	msg: string;
}

export interface IRTMTypeEnvelope {
	id: number;
	type: string;
}

export interface IRTMTypeEnvelopeReply extends IRTMTypeEnvelope {
	reply_to: number;
}

export interface IRTMTypeError extends IRTMTypeEnvelope {
	error: IRTMDataError;
}

export interface IRTMTypeSubTypeEnvelope extends IRTMTypeEnvelope {
	subtype: string;
}

export interface IRTMTypePingPong extends IRTMTypeEnvelope {
	ts: number;
	auth?: string;
}

export interface IRTMTypeWebRTC extends IRTMTypeSubTypeEnvelope {
	target: string;
	source: string;
	initiator: boolean;
	state: string;
	channel: string;
	group?: string;
	hash: string;
	data: any;
	v: number;
}

export class RTMDataError {
	public code: string;
	public msg: string = '';

	constructor(data: IRTMDataError) {
		this.code = data.code;
		this.msg = data.msg;
	}
}
