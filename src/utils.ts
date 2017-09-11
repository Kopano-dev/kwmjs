/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

'use strict';

/**
 * @private
 */
export function makeAbsoluteURL(url: string): string {
	const a = document.createElement('a');
	a.href = url;
	return a. href;
}

/**
 * @private
 */
export function toHexString(byteArray: number[]) {
	return byteArray.map(byte => {
		return ('0' + (/* tslint:disable */byte & 0xFF/* tslint:enable */).toString(16)).slice(-2);
	}).join('');
}

/**
 * @private
 */
export function getRandomString(length?: number) {
	const bytes = new Uint8Array((length || 32) / 2);
	window.crypto.getRandomValues(bytes);
	return toHexString(Array.from(bytes));
}
