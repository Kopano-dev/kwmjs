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
		constructor(options: any);

		public on(name: string, handler: (event: any) => void): void;
		public signal(jsep: any): void;
		public destroy(): void;

		public removeStream(stream: MediaStream): void;
		public addStream(stream: MediaStream): void;

		public removeTrack(track: MediaStreamTrack, stream: MediaStream): void;
		public addTrack(track: MediaStreamTrack, stream: MediaStream): void;

		public _needsNegotiation(): void;
	}

	namespace Peer {}
	export = Peer;
}
