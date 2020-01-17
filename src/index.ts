import { newPromiEvent, PromiEvent } from "./promiEvent";
import { RenElementHTML, RenGatewayContainerHTML } from "./ren";
import { Chain, Network, Tokens } from "./renJsCommon";
import {
    Commitment, GatewayMessage, GatewayMessageType, HistoryEvent, ShiftInStatus, ShiftOutStatus,
} from "./types";

export { HistoryEvent, ShiftInStatus, ShiftOutEvent } from "./types";
export { Chain, Network, Tokens } from "./renJsCommon";

const randomNonce = () => {
    const uints = new Uint32Array(32 / 4); // 4 bytes (32 bits)
    window.crypto.getRandomValues(uints);
    let str = "";
    for (const uint of uints) {
        str += "0".repeat(8 - uint.toString(16).length) + uint.toString(16);
    }
    return "0x" + str;
};

const utils = {
    randomNonce,
};

// For now, the endpoints are network specific.
const GATEWAY_ENDPOINT = "https://gateway-staging.renproject.io/";
const GATEWAY_ENDPOINT_CHAOSNET = "https://gateway.renproject.io/";

const sleep = async (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getElement = (id: string) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Unable to find element ${id}`);
    }
    return element;
};

const createElementFromHTML = (htmlString: string) => {
    const div = document.createElement("div");
    // tslint:disable-next-line: no-object-mutation
    div.innerHTML = htmlString.trim();
    return div.firstChild;
};

// TODO: Generate uuid properly
const randomID = () => String(Math.random()).slice(2);

// const GATEWAY_URL = "http://localhost:3344/";

const resolveEndpoint = (endpoint: Network | string) => {
    switch (endpoint) {
        case Network.Testnet:
            return GATEWAY_ENDPOINT;
        case Network.Chaosnet:
            return GATEWAY_ENDPOINT_CHAOSNET;
        case Network.Mainnet:
        case Network.Devnet:
        case Network.Localnet:
            throw new Error(`GatewayJS does not support the network ${endpoint} yet.`);
        default:
            return endpoint;
    }
};

export class Gateway {

    public static readonly Tokens = Tokens;
    public static readonly Networks = Network;
    public static readonly Chains = Chain;
    public static readonly ShiftInStatus = ShiftInStatus;
    public static readonly ShiftOutStatus = ShiftOutStatus;
    public static readonly utils = utils;
    public static readonly askForAddress = (token?: string) => {
        return `__renAskForAddress__${token ? token.toUpperCase() : ""}`;
    }

    // tslint:disable-next-line: readonly-keyword
    public isPaused = false;
    // tslint:disable-next-line: readonly-keyword
    public isOpen = false;

    // Each GatewayJS instance has a unique ID
    private readonly id: string;
    private readonly endpoint: string;

    // tslint:disable-next-line: readonly-keyword
    private isCancelling = false;

    // tslint:disable-next-line: no-any
    private readonly promiEvent: PromiEvent<any> = newPromiEvent();

    // FIXME: Passing in an endpoint is great for development but probably not very secure
    constructor(endpoint?: Network | string) {
        this.endpoint = resolveEndpoint(endpoint || GATEWAY_ENDPOINT);
        this.id = randomID();
    }

    public readonly getPopup = () => getElement(`_ren_gateway-${this.id}`);
    public readonly getIFrame = () => getElement(`_ren_iframe-${this.id}`);
    public readonly getOrCreateGatewayContainer = () => {
        try {
            return getElement(`_ren_gatewayContainer`);
        } catch (error) {
            // Ignore error
        }

        const body: ReadonlyArray<HTMLBodyElement | HTMLHtmlElement> = [...(Array.from(document.getElementsByTagName("body")) || []), ...(Array.from(document.getElementsByTagName("html")) || [])];

        const popup = createElementFromHTML(RenGatewayContainerHTML());

        if (body[0] && popup) {
            body[0].insertBefore(popup, body[0].lastChild);
        }

        return getElement(`_ren_gatewayContainer`);
    }

    public readonly close = () => {
        try {
            const renElement = this.getPopup();
            if (renElement.parentElement) {
                renElement.parentElement.removeChild(renElement);
            }
            // tslint:disable-next-line: no-object-mutation
            this.isOpen = false;
        } catch (error) {
            console.error(error);
        }
    }

    public readonly pause = async () => {
        this._pause();
        await this.sendMessage(GatewayMessageType.Pause, {});
        return this;
    }

    public readonly resume = async () => {
        this._resume();
        await this.sendMessage(GatewayMessageType.Resume, {});
        return this;
    }

    public readonly cancel = async () => {
        // tslint:disable-next-line: no-object-mutation
        this.isCancelling = true;
        await this.sendMessage(GatewayMessageType.Cancel, {});
        return this;
    }

    public readonly getGateways = async () => new Promise<Map<string, HistoryEvent>>((resolve, reject) => {
        const container = this.getOrCreateGatewayContainer();

        const iframe = (uniqueID: string, iframeURL: string) => `
        <iframe class="_ren_iframe-hidden" id="_ren_iframe-hidden-${uniqueID}" style="display: none"
            src="${`${iframeURL}#/unfinished?id=${uniqueID}`}" ></iframe>
        `;

        const popup = createElementFromHTML(iframe(this.id, this.endpoint));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        // tslint:disable-next-line: no-any
        let listener: (e: { readonly data: GatewayMessage<any> }) => void;

        const close = () => {
            if (popup) {
                window.removeEventListener("message", listener);
                container.removeChild(popup);
            }
        };

        // tslint:disable-next-line: no-any
        listener = (e: { readonly data: GatewayMessage<any> }) => {
            if (e.data && e.data.from === "ren" && e.data.frameID === this.id) {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        if (popup) {
                            this.sendMessage(GatewayMessageType.GetTrades, { frameID: this.id }, popup).catch(console.error);
                        }
                        break;
                    case "getTrades":
                        if (e.data.error) {
                            close();
                            reject(new Error(e.data.error));
                        } else {
                            close();
                            resolve(e.data.payload);
                        }
                        break;
                }
            }
        };

        window.addEventListener("message", listener);
    })

    public readonly open = (params: Commitment): Gateway => {

        (async () => {

            // Check that GatewayJS isn't already open
            let existingPopup;
            try { existingPopup = this.getPopup(); } catch (error) { /* Ignore error */ }
            if (existingPopup) { throw new Error("GatewayJS already open"); }

            const container = this.getOrCreateGatewayContainer();

            const popup = createElementFromHTML(RenElementHTML(this.id, `${this.endpoint}#/?id=${this.id}`, this.isPaused));

            if (popup) {
                container.insertBefore(popup, container.lastChild);
                // tslint:disable-next-line: no-object-mutation
                this.isOpen = true;
            }

            // tslint:disable-next-line: no-any
            let listener: (e: { readonly data: GatewayMessage<any> }) => void;

            const close = () => {
                // Remove listener
                window.removeEventListener("message", listener);
                this.close();
            };

            // tslint:disable-next-line: no-any
            listener = (e: { readonly data: GatewayMessage<any> }) => {
                if (e.data && e.data.from === "ren" && e.data.frameID === this.id) {
                    // alert(`I got a message: ${JSON.stringify(e.data)}`);
                    switch (e.data.type) {
                        case "ready":
                            this.sendMessage(GatewayMessageType.Shift, {
                                shift: {
                                    frameID: this.id,
                                    sendToken: params.sendToken,
                                    sendTo: params.sendTo,
                                    sendAmount: params.sendAmount,
                                    contractFn: params.contractFn,
                                    contractParams: params.contractParams,
                                    nonce: params.nonce,
                                },
                                paused: this.isPaused,
                            }).catch(console.error);
                            if (this.isPaused) {
                                this.pause().catch(console.error);
                            }
                            break;
                        case GatewayMessageType.Status:
                            this._pause();
                            break;
                        case GatewayMessageType.Pause:
                            this._pause();
                            break;
                        case GatewayMessageType.Resume:
                            this._resume();
                            break;
                        case GatewayMessageType.Cancel:
                            close();
                            if (this.isCancelling) {
                                // tslint:disable-next-line: no-object-mutation
                                this.isCancelling = false;
                                return;
                            } else {
                                // tslint:disable-next-line: no-object-mutation
                                this.isCancelling = false;
                                throw new Error("Shift cancelled by user");
                            }
                        case GatewayMessageType.Done:
                            close();
                            return e.data.payload;
                    }
                }
            };

            window.addEventListener("message", listener);

            // Add handler to overlay
            const overlay = document.querySelector("._ren_overlay");
            if (overlay) {
                // tslint:disable-next-line: no-object-mutation no-any
                (overlay as any).onclick = () => {
                    this.pause().catch(console.error);
                };
            }

        })().then(this.promiEvent.resolve).catch(this.promiEvent.reject);

        return this;
    }

    public readonly result = () => this.promiEvent;


    private readonly sendMessage = async <T>(type: GatewayMessageType, payload: T, iframeIn?: ChildNode) => new Promise<void>(async (resolve) => {

        // TODO: Allow response in acknowledgement.

        const frame = iframeIn || this.getIFrame();

        while (!frame) {
            await sleep(1 * 1000);
        }

        const messageID = randomID();

        // tslint:disable-next-line: no-any
        let listener: (e: { readonly data: GatewayMessage<any> }) => void;

        let acknowledged = false;
        const removeListener = () => {
            acknowledged = true;
            window.removeEventListener("message", listener);
        };

        // tslint:disable-next-line: no-any
        listener = (e: { readonly data: GatewayMessage<any> }) => {
            if (e.data && e.data.from === "ren" && e.data.messageID === messageID) {
                removeListener();
                resolve();
            }
        };

        window.addEventListener("message", listener);

        // Repeat message until acknowledged
        // tslint:disable-next-line: no-any
        const contentWindow = (frame as any).contentWindow;
        while (!acknowledged && contentWindow) {
            const gatewayMessage: GatewayMessage<T> = { from: "ren", frameID: this.id, type, payload, messageID };
            // tslint:disable-next-line: no-any
            contentWindow.postMessage(gatewayMessage, "*");
            await sleep(1 * 1000);
        }
    })


    private readonly _pause = () => {
        // tslint:disable-next-line: no-object-mutation
        this.isPaused = true;
        this.getPopup().classList.add("_ren_gateway-minified");
    }

    private readonly _resume = () => {
        // tslint:disable-next-line: no-object-mutation
        this.isPaused = false;
        this.getPopup().classList.remove("_ren_gateway-minified");
    }
}

export default class GatewayJS {

    public static readonly Tokens = Tokens;
    public static readonly Networks = Network;
    public static readonly Chains = Chain;
    public static readonly ShiftInStatus = ShiftInStatus;
    public static readonly ShiftOutStatus = ShiftOutStatus;
    public static readonly utils = utils;
    public static readonly askForAddress = (token?: string) => {
        return `__renAskForAddress__${token ? token.toUpperCase() : ""}`;
    }

    private readonly endpoint: string;
    constructor(endpoint?: Network | string) {
        this.endpoint = resolveEndpoint(endpoint || GATEWAY_ENDPOINT);
    }

    /**
     * Returns a map containing previously opened gateways.
     */
    public readonly getGateways = async (): Promise<Map<string, HistoryEvent>> => {
        return new Gateway(this.endpoint).getGateways();
    }

    /**
     * Creates a new Gateway instance.
     */
    public readonly open = (params: Commitment): Gateway => {
        return new Gateway(this.endpoint).open(params);
    }
}



////////////////////////////////////////////////////////////////////////////////
// EXPORTS                                                                    //
// Based on https://github.com/MikeMcl/bignumber.js/blob/master/bignumber.js  //
////////////////////////////////////////////////////////////////////////////////

// tslint:disable: no-any no-object-mutation strict-type-predicates

// tslint:disable-next-line: no-string-literal
(GatewayJS as any)["default"] = (GatewayJS as any).GatewayJS = GatewayJS;

declare global {
    let define: any;
    // let module: any;
}
if (typeof define === "function" && define.amd) {
    // AMD.
    define(() => GatewayJS);

    // @ts-ignore
} else if (typeof module !== "undefined" && module.exports) {
    // Node.js and other environments that support module.exports.
    try {
        // @ts-ignore
        module.exports = GatewayJS;
    } catch (error) {
        // ignore error
    }
} else {
    // Browser.
    if (typeof window !== "undefined" && window) {
        (window as any).GatewayJS = GatewayJS;
    }
}
