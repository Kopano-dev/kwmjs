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

export interface ISelf {
	id: string;
	name: string;
}

export interface IRTMDataError {
	code: string;
	msg: string;
}

export interface IRTMTransaction {
	transaction?: string;
}

export interface IRTMTypeEnvelope {
	id: number;
	type: string;
}

export interface IRTMTypeHello extends IRTMTypeEnvelope {
	self?: ISelf;
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
	profile?: IRTMDataProfile;
	state: string;
	channel: string;
	group?: string;
	hash: string;
	data: any;
	v: number;
	transaction?: string;
	pcid?: string;
}

export interface IRTMDataProfile {
	name?: string;
}

export interface IRTMDataWebRTCChannelExtra {
	group?: IRTMDataWebRTCChannelGroup;
	pipeline?: IRTMDataWebRTCChannelPipeline;
	replaced?: boolean;
}

export interface IRTMDataWebRTCChannelGroup {
	group: string;
	members: string[];
}

export interface IRTMDataWebRTCChannelPipeline {
	pipeline: string;
	mode: string;
}

export class RTMDataError {
	public code: string;
	public msg: string = '';

	public constructor(data: IRTMDataError) {
		this.code = data.code;
		this.msg = data.msg;
	}
}
