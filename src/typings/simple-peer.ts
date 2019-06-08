/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

declare module 'simple-peer' {
	class Peer {
		public _id: string; // tslint:disable-line variable-name
		public destroyed: boolean;
		public connected: boolean;
		public initiator: boolean;

		public constructor(options: any);

		public on(name: string, handler: (event: any, ...opts: any[]) => void): void;
		public emit(name: string, event: any): void;
		public signal(jsep: any): void;
		public destroy(): void;

		public removeStream(stream: MediaStream): void;
		public addStream(stream: MediaStream): void;

		public removeTrack(track: MediaStreamTrack, stream: MediaStream): void;
		public addTrack(track: MediaStreamTrack, stream: MediaStream): void;

		public send(chunk: ArrayBufferView | ArrayBuffer | string | Blob): void;

		public _needsNegotiation(): void;
	}

	namespace Peer {} // eslint-disable-line @typescript-eslint/no-namespace
	export = Peer;
}
