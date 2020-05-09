/*
 * Copyright 2018 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import { IRTMTypeWebRTC } from './rtm';
import { PeerRecord, WebRTCManager } from './webrtc';

export class GroupController {
	public id: string;
	public record: PeerRecord;

	public channel?: string;
	public members: string[];

	private webrtc: WebRTCManager;

	public constructor(webrtc: WebRTCManager, id: string, record: PeerRecord) {
		this.webrtc = webrtc;
		this.id = id;
		this.record = record;
		this.members = [];
	}

	public handleWebRTCMessage(message: IRTMTypeWebRTC): void {
		switch (message.subtype) {
			case 'webrtc_channel': {
				if (this.channel && message.channel !== this.channel) {
					console.warn('invalid webrtc group channel', this.channel, message.channel);
					return;
				}
				if (!message.data || message.data.group.group !== this.id) {
					console.warn('invalid webrtc group', this.id, message.data);
					return;
				}

				this.channel = message.channel;

				const { members, reset } = message.data.group;
				members.sort();
				this.updateMembers(members, reset);
				break;
			}

			default:
				console.warn('unknown webrtc group mesage', message.subtype);
				break;

		}
	}

	public hasMember(user: string): boolean {
		return this.members.indexOf(user) >= 0;
	}

	private async updateMembers(members: string[], reset = false): Promise<void> {
		if (reset) {
			// Kill all existing connections if reset is set.
			await this.webrtc.doMesh([], this.record)
		}

		// Establish mesh.
		const previous = this.members;
		this.members = members;
		await this.webrtc.doMesh(members, this.record).catch(err => {
			console.error('failed to establish mesh for all group members', err);
		});
	}
}
