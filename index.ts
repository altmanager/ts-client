import * as SocketIOClient from "socket.io-client";
import EventEmitter from "events";

/**
 * Alt manager API client
 */
class AltManager {
    /**
     * Web socket client
     * @internal
     */
    public readonly _socket: SocketIOClient.Socket;

    /**
     * Construct new API client instance
     * @param [baseUrl] Base URL of the API. Default: `http://localhost:8080`
     */
    constructor(public readonly baseUrl: string = 'http://localhost:8080') {
        this._socket = SocketIOClient.io(baseUrl);
    }

    /**
     * Fetch data from the API
     * @internal
     */
    public async _fetch(path: string, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET', body?: Record<string, any>): Promise<any> {
        const url = new URL(path, this.baseUrl);
        const options: RequestInit & {headers: Record<string, string>} = {
            method,
            headers: {},
        };
        if (body) {
            if (["GET", "HEAD", "DELETE", "OPTIONS"].includes(method)) {
                for (const [key, value] of Object.entries(body)) {
                    url.searchParams.append(key, value);
                }
            }
            else {
                options.body = JSON.stringify(body);
                options.headers["content-type"] = "application/json";
            }
        }
        const res = await fetch(url.toString(), options);
        let data;
        if (res.headers.get('content-type')?.startsWith('application/json')) data = await res.json();
        else data = await res.text();

        if (!res.ok) throw new Error(`Error: ${res.status}: ${(data as any)?.error ?? data}`);
        return data;
    }

    /**
     * List all players
     */
    public async listPlayers(): Promise<(AltManager.OfflinePlayer | AltManager.Player)[]> {
        const data = await this._fetch('/players');
        return data.map((p: any) => {
            const offlinePlayer = new AltManager.OfflinePlayer(this, p.id, p.name, p.authMethod, p.lastOnline ? new Date(p.lastOnline) : null);
            const player = p.online ? new AltManager.Player(offlinePlayer, p.server, p.version, p.username, p.uuid, p.liveData) : null;
            return player ?? offlinePlayer;
        });
    }

    /**
     * Get a player by ID
     * @param id Internal alt manager player ID
     */
    public async getPlayer(id: AltManager.PlayerId): Promise<AltManager.OfflinePlayer | AltManager.Player> {
        const data = await this._fetch(`/players/${id}`);
        const offlinePlayer = new AltManager.OfflinePlayer(this, data.id, data.name, data.authMethod, data.lastOnline ? new Date(data.lastOnline) : null);
        const Player = data.online ? new AltManager.Player(offlinePlayer, data.server, data.version, data.username, data.uuid, data.liveData) : null;
        return Player ?? offlinePlayer;
    }

    /**
     * Create a new player
     * @param name Player username (Mojang/offline mode) or email (Microsoft account)
     * @param [password] Player password. Only required for Mojang accounts.
     * @param [authMethod] Authentication method. Default: `offline`
     */
    public async createPlayer(name: string, password?: string, authMethod: "mojang" | "microsoft" | "offline" = "offline"): Promise<AltManager.OfflinePlayer> {
        const data = await this._fetch('/players', 'POST', {name, password, authMethod});
        return new AltManager.OfflinePlayer(this, data.id, data.name, data.authMethod, data.lastOnline ? new Date(data.lastOnline) : null);
    }
}

namespace AltManager {
    /**
     * Internal alt manager player ID
     *
     * > **Note**: This is an internal alt manager ID, not a Minecraft UUID.
     * @example '24a2bdc1-6dd9-40c4-b011-daa29c5ed59f'
     */
    export type PlayerId = `${string}-${string}-${string}-${string}-${string}`;

    abstract class Client {
        /**
         * @param client AltManager API client instance used to fetch the data
         * @protected
         */
        protected constructor(public readonly client: AltManager) {}
    }

    /**
     * A player that you have created.
     *
     * An offline player has not been authenticated yet and is not connected to a server.
     */
    export class OfflinePlayer extends Client {
        /**
         * Event emitter
         */
        private readonly eventEmitter = new EventEmitter();

        /**
         * The player has been authenticated and connected to a server
         */
        public on(event: "connect", listener: (player: Player) => void): this;
        public on(event: string, listener: (...args: any[]) => void): this {
            this.eventEmitter.on(event, listener);
            return this;
        }


        /**
         * Whether the player is online. This is never the case for OfflinePlayer.
         */
        public readonly online = false;

        /**
         * Construct new OfflinePlayer instance
         * @param client AltManager API client instance used to fetch the data
         * @param id Unique player ID. **NOTE**: This is an internal alt manager ID, not a Minecraft UUID.
         * @param name Player username (Mojang/offline mode) or email (Microsoft account)
         * @param authMethod The authentication method used to log in
         * @param lastOnline Date when the player was last online. `null` if the player has never been online
         */
        constructor(client: AltManager, public readonly id: PlayerId, public readonly name: string, public readonly authMethod: "mojang" | "microsoft" | "offline", public readonly lastOnline: Date | null) {
            super(client);
        }

        /**
         * Connect to a server
         * @param server Server address
         * @param [version] Server version. If omitted, the version is determined automatically from the server
         * @param [brand] Client brand
         */
        public async connect(server: string, version?: string, brand?: string): Promise<AltManager.Player> {
            const data = await this.client._fetch(`/players/${this.id}/connect`, 'POST', {server, version, brand});
            return new AltManager.Player(this, data.server, data.version, data.username, data.uuid, data.liveData);
        }

        /**
         * Delete this player
         */
        public async delete(): Promise<void> {
            await this.client._fetch(`/players/${this.id}`, 'DELETE');
        }
    }

    /**
     * An authenticated player that is connected to a server.
     */
    export class Player {
        /**
         * Event emitter
         */
        private readonly eventEmitter = new EventEmitter();

        /**
         * The player's health has changed
         */
        public on(event: "healthChange", listener: (previousData: typeof Player.prototype.health) => void): this;
        /**
         * The player's hunger has changed
         */
        public on(event: "hungerChange", listener: (previousHunger: typeof Player.prototype.hunger) => void): this;
        /**
         * The player's ping has changed
         */
        public on(event: "pingChange", listener: (previousPing: typeof Player.prototype.ping) => void): this;
        /**
         * The player's game mode has changed
         */
        public on(event: "gameModeChange", listener: (previousGameMode: typeof Player.prototype.gameMode) => void): this;
        /**
         * The player's coordinates have changed
         */
        public on(event: "coordinatesChange", listener: (previousCoordinates: typeof Player.prototype.coordinates) => void): this;
        /**
         * The player's live data has changed
         */
        public on(event: "change", listener: (previousData: typeof Player.prototype.liveData) => void): this;
        /**
         * The player has received a chat message
         * @todo Add chat message type
         */
        public on(event: "chat", listener: (message: any) => void): this;
        /**
         * The player has disconnected from the server
         */
        public on(event: "disconnect", listener: () => void): this;
        public on(event: string, listener: (...args: any[]) => void): this {
            this.eventEmitter.on(event, listener);
            return this;
        }


        /**
         * Whether the player is online. This is always the case for Player.
         */
        public readonly online = true;

        /**
         * AltManager API client instance used to fetch the data
         */
        public get client(): AltManager {
            return this.offlinePlayer.client;
        }

        /**
         * Dynamic/live player data
         */
        private liveData: {health: number, hunger: number, ping: number, gameMode: "survival" | "creative" | "adventure" | "spectator", coordinates: [number, number, number]};

        /**
         * The player's current health (0-20)
         */
        public get health(): number {
            return this.liveData.health;
        }

        /**
         * The player's current food/hunger (0-20)
         */
        public get hunger(): number {
            return this.liveData.hunger;
        }

        /**
         * The player's current ping (in milliseconds)
         */
        public get ping(): number {
            return this.liveData.ping;
        }

        /**
         * The player's current game mode
         */
        public get gameMode(): "survival" | "creative" | "adventure" | "spectator" {
            return this.liveData.gameMode;
        }

        /**
         * The player's current coordinates
         */
        public get coordinates(): [number, number, number] {
            return this.liveData.coordinates;
        }

        /**
         * Construct new Player instance
         * @param offlinePlayer This player's  offline player
         * @param server The address of the server the player is connected to
         * @param version The player's Minecraft version
         * @param username The player's Minecraft username
         * @param uuid The player's Minecraft UUID
         * @param liveData Dynamic/live player data
         */
        constructor(public readonly offlinePlayer: OfflinePlayer, public readonly server: string, public readonly version: string, public readonly username: string, public readonly uuid: string, liveData: typeof Player.prototype.liveData) {
            this.liveData = liveData;

            // subscribe to live data updates
            this.offlinePlayer.client._socket.emit("subscribe", this.offlinePlayer.id);
            this.offlinePlayer.client._socket.on("data", (data: typeof Player.prototype.liveData) => {
                // detect changes
                const keys = Object.keys(data) as (keyof typeof Player.prototype.liveData)[];
                for (const key of keys) if (data[key] !== this.liveData[key]) this.eventEmitter.emit(key + "Change", this.liveData[key]);
                this.eventEmitter.emit("change", this.liveData);
                // update live data
                this.liveData = data;
            });
            this.offlinePlayer.client._socket.on("chat", (message: string) => {
                this.eventEmitter.emit("chat", message);
            });
        }

        /**
         * Disconnect from current server
         */
        public async disconnect(): Promise<void> {
            this.offlinePlayer.client._socket.emit("unsubscribe", this.offlinePlayer.id);
            await this.client._fetch(`/players/${this.offlinePlayer.id}/disconnect`, 'POST');
            this.eventEmitter.emit("disconnect");
        }

        /**
         * Send a chat message or run a command
         * @param message Message or command to send
         */
        public async send(message: string): Promise<void> {
            await this.client._fetch(`/players/${this.offlinePlayer.id}/chat`, 'POST', {message});
        }
    }
}

export default AltManager;
