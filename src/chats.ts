/*
 * Copyright 2020 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

import { IRTMTypeEnvelope, IRTMTypeChats, IRTMDataChatsMessage } from './rtm';
import { ChatsMessageEvent, ChatsSystemEvent } from './events';

/**
 * A IChatsManagerContainer is a container which connects ChatsManagers with
 * the ouside world.
 */
export interface IChatsManagerContainer {
	sendWebSocketPayload(payload: IRTMTypeEnvelope, replyTimeout?: number): Promise<IRTMTypeEnvelope>;
}

/**
 * A ChatsManager bundles all Chat related client functionality.
 */
export class ChatsBaseManager {
	/**
	 * Chats payload version. All Chats payloads will include this value and
	 * clients can use it to check if they are compatible with the received
	 * data. This client will reject all messages which are from received with
	 * older version than defined here. Also the server might reject messages
	 * for versions deemed too old.
	 */
	public static version = 20201201;

	/**
	 * Event handler for [[ChatsMessageEvent]]. Set to a function to get called
	 * whenever [[ChatsMessageEvent]]s are triggered.
	 */
	public onmessage?: (event: ChatsMessageEvent) => void;

	/**
	 * Event handler for [[ChatsSystemEvent]]. Set to a function to get called
	 * whenever [[ChatsSystemEvent]]s are triggered.
	 */
	public onsystem?: (event: ChatsSystemEvent) => void;

	protected kwm: IChatsManagerContainer;

	/**
	 * Creates ChatsManager instance bound to the provided [[KWM]].
	 *
	 * @param container Reference to a IChatsManagerContainer instance.
	 */
	public constructor(kwm: IChatsManagerContainer) {
		this.kwm = kwm;
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
			case ChatsMessageEvent.getName():
				if (this.onmessage) {
					this.onmessage(event);
				}
				break;
			case ChatsSystemEvent.getName():
				if (this.onsystem) {
					this.onsystem(event);
				}
				break;
			default:
				throw new Error('unknown event: ' + event.constructor.getName());
		}
	}
}

/**
 * A ChatsManager bundles all Chat related client functionality.
 */
export class ChatsManager extends ChatsBaseManager {
	/**
	 * Sends a chat message via RTM to the provided channel.
	 *
	 * @param channel The channel, this chat message should be bound to.
	 * @param message The chat message payload.
	 * @returns Promise providing the message ID assigned to the new message on the server.
	 */
	public async doSendChatMessage(channel: string, message: IRTMDataChatsMessage): Promise<IRTMDataChatsMessage> {
		//console.debug('chat doSendChatMessage', channel, message);

		if (message.id === undefined) {
			throw new Error('no id');
		}
		if (message.sender !== '') {
			throw new Error('sender must be empty');
		}

		const reply = await this.sendChats('chats_message', channel, message, 5000) as IRTMTypeChats;
		return (reply.data as IRTMDataChatsMessage);
	}

	protected async sendChats(
		subtype: string, channel: string, data?: any, replyTimeout = 0, transaction = ''): Promise<IRTMTypeEnvelope> {
		const payload: IRTMTypeChats = {
			channel,
			data,
			id: 0,
			subtype,
			transaction,
			type: 'chats',
			v: ChatsManager.version,
		};

		return this.kwm.sendWebSocketPayload(payload, replyTimeout);
	}

	/**
	 * Process incoming KWM RTM API Chats related payload data.
	 *
	 * @private
	 * @param message Payload message.
	 */
	public handleChatsMessage(message: IRTMTypeChats): void {
		//console.debug('<<< chats', message);

		if (!message.v || message.v < ChatsManager.version) {
			console.log('chats ignoring message with outdated version', message.v, message);
			return;
		}

		switch (message.subtype) {
			case 'chats_message': {
				const event = new ChatsMessageEvent(this, message.data, message.profile);
				event.channel = message.channel;
				this.dispatchEvent(event, true);
				break;
			}
			case 'chats_system': {
				const event = new ChatsSystemEvent(this, message.data, message.profile);
				event.channel = message.channel;
				this.dispatchEvent(event, true);
				break;
			}
		}
	}
}
