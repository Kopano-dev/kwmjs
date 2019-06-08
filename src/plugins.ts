/*
 * Copyright 2017 Kopano
 *
 * Use of this source code is governed by a MIT license
 * that can be found in the LICENSE.txt file.
 *
 */

import { KWM } from './kwm';

/**
 * A Iplugin<T> is the generic interface for plugins.
 */
export interface IPlugin<T> {
	/**
	 * Constructor for plugins.
	 *
	 * @param kwm Reference to an instance the plugin can use.
	 * @param callbacks flexible parameter, plugin specific.
	 * @returns The plugin instance, created with the provided parameters.
	 */
	new(kwm: KWM, callbacks: any): T;

	/**
	 * Provides the name of the plugin.
	 *
	 * @returns Unique id of the plugin used as name.
	 */
	getName(): string;
}

/**
 * Plugins implement the registry for plugins.
 */
export class Plugins {
	/**
	 * Registers the provided plugin class in the registry.
	 *
	 * @param plugin Factory class of the plugin to register.
	 */
	public static register(plugin: IPlugin<any>): void {
		this.registry.set(plugin.getName(), plugin);
	}

	/**
	 * Fetch a registered plugin class by name.
	 *
	 * @returns Plugin factory.
	 */
	public static get(name: string): IPlugin<any> | undefined {
		return this.registry.get(name);
	}

	private static registry = new Map<string, IPlugin<any>>();
}
