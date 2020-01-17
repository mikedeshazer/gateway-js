import { newPromiEvent, PromiEvent } from "./promiEvent";
import { RenElementHTML, RenGatewayContainerHTML } from "./ren";
import { Commitment, GatewayMessage, GatewayMessageType, HistoryEvent } from "./types";

export { HistoryEvent } from "./types";

// tslint:disable

// For now, the endpoints are network specific.
const GATEWAY_ENDPOINT = "https://gateway-staging.renproject.io/";
const GATEWAY_ENDPOINT_CHAOSNET = "https://gateway.renproject.io/";

const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const getElement = (id: string) => {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Unable to find element ${id}`);
    }
    return element;
}

function createElementFromHTML(htmlString: string) {
    var div = document.createElement('div');
    div.innerHTML = htmlString.trim();
    return div.firstChild;
}

// TODO: Generate uuid properly
const randomID = () => String(Math.random()).slice(2);

// const GATEWAY_URL = "http://localhost:3344/";

export default class GatewayJS {
    private endpoint: string;
    constructor(endpoint?: string) {
        if (endpoint === "testnet") {
            endpoint = GATEWAY_ENDPOINT;
        }
        if (endpoint === "chaosnet") {
            endpoint = GATEWAY_ENDPOINT_CHAOSNET;
        }
        this.endpoint = endpoint || GATEWAY_ENDPOINT;
    }

    public unfinishedTrades = async (): Promise<Map<string, HistoryEvent>> => {
        return new Gateway(this.endpoint).unfinishedTrades();
    }

    public open = (params: Commitment): Gateway => {
        return new Gateway(this.endpoint).open(params);
    }
}

export class Gateway {
    // Each GatewayJS instance has a unique ID
    private id: string;
    private endpoint: string;

    public isPaused = false;
    public isOpen = false;
    private isCancelling = false;

    private promiEvent: PromiEvent<any> = newPromiEvent();

    // FIXME: Passing in an endpoint is great for development but probably not very secure
    constructor(endpoint?: string) {
        if (endpoint === "testnet") {
            endpoint = GATEWAY_ENDPOINT;
        }
        if (endpoint === "chaosnet") {
            endpoint = GATEWAY_ENDPOINT_CHAOSNET;
        }
        this.id = randomID();
        this.endpoint = endpoint || GATEWAY_ENDPOINT;
    }

    public getPopup = () => getElement(`_ren_gateway-${this.id}`);
    public getIFrame = () => getElement(`_ren_iframe-${this.id}`)
    public getOrCreateGatewayContainer = () => {
        try {
            return getElement(`_ren_gatewayContainer`);
        } catch (error) {
            // Ignore error
        }

        var body = [...(Array.from(document.getElementsByTagName('body')) || []), ...(Array.from(document.getElementsByTagName('html')) || [])];

        const popup = createElementFromHTML(RenGatewayContainerHTML());

        if (body[0] && popup) {
            body[0].insertBefore(popup, body[0].lastChild);
        }

        return getElement(`_ren_gatewayContainer`);
    }

    public static askForAddress = (token?: string) => {
        return `__renAskForAddress__${token ? token.toUpperCase() : ""}`;
    }

    private sendMessage = <T>(type: GatewayMessageType, payload: T, iframeIn?: ChildNode) => new Promise<void>(async (resolve) => {
        let frame = iframeIn || this.getIFrame();

        while (!frame) {
            await sleep(1 * 1000);
        }

        const messageID = randomID();

        let listener: (e: { data: GatewayMessage<any> }) => void;

        let acknowledged = false;
        const removeListener = () => {
            acknowledged = true;
            window.removeEventListener("message", listener);
        }

        listener = (e: { data: GatewayMessage<any> }) => {
            if (acknowledged) {
                console.log(`removing didn't work!`);
            }
            if (e.data && e.data.from === "ren" && e.data.messageID === messageID) {
                removeListener();
                resolve();
            }
        }

        window.addEventListener('message', listener);

        // Repeat message until acknowledged
        while (!acknowledged && (frame as any).contentWindow) {
            const gatewayMessage: GatewayMessage<T> = { from: "ren", frameID: this.id, type, payload, messageID };
            (frame as any).contentWindow.postMessage(gatewayMessage, '*');
            await sleep(1 * 1000);
        }
    });


    public close = () => {
        try {
            const renElement = this.getPopup();
            if (renElement.parentElement) {
                renElement.parentElement.removeChild(renElement);
            }
            this.isOpen = false;
        } catch (error) {
            console.error(error);
        }
    }

    private _pause = () => {
        this.isPaused = true;
        this.getPopup().classList.add("_ren_gateway-minified");
    }

    private _resume = () => {
        this.isPaused = false;
        this.getPopup().classList.remove("_ren_gateway-minified");
    }

    public pause = async () => {
        this._pause();
        await this.sendMessage(GatewayMessageType.Pause, {});
        return this;
    }

    public resume = async () => {
        this._resume();
        await this.sendMessage(GatewayMessageType.Resume, {});
        return this;
    }

    public cancel = async () => {
        this.isCancelling = true;
        await this.sendMessage(GatewayMessageType.Cancel, {});
        return this;
    }

    public unfinishedTrades = async () => new Promise<Map<string, HistoryEvent>>((resolve, reject) => {
        const container = this.getOrCreateGatewayContainer();

        const iframe = (uniqueID: string, iframeURL: string) => `
        <iframe class="_ren_iframe-hidden" id="_ren_iframe-hidden-${uniqueID}" style="display: none"
            src="${`${iframeURL}#/unfinished?id=${uniqueID}`}" ></iframe>
        `

        const popup = createElementFromHTML(iframe(this.id, this.endpoint));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        let listener: (e: { data: GatewayMessage<any> }) => void;

        const close = () => {
            if (popup) {
                window.removeEventListener("message", listener);
                container.removeChild(popup);
            }
        }

        listener = (e: { data: GatewayMessage<any> }) => {
            if (e.data && e.data.from === "ren") {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        if (popup) {
                            this.sendMessage(GatewayMessageType.GetTrades, { frameID: this.id }, popup);
                        }
                        break;
                    case "getTrades":
                        if (e.data.frameID === this.id)
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

        window.addEventListener('message', listener);
    })

    public open = (params: Commitment): Gateway => {

        (async () => {

            // Check that GatewayJS isn't already open
            let existingPopup;
            try { existingPopup = this.getPopup(); } catch (error) { /* Ignore error */ }
            if (existingPopup) { throw new Error("GatewayJS already open"); }

            const container = this.getOrCreateGatewayContainer();

            const popup = createElementFromHTML(RenElementHTML(this.id, `${this.endpoint}#/?id=${this.id}`, this.isPaused));

            if (popup) {
                container.insertBefore(popup, container.lastChild);
                this.isOpen = true;
            }

            let listener: (e: { data: GatewayMessage<any> }) => void;

            const close = () => {
                // Remove listener
                window.removeEventListener("message", listener);
                this.close();
            }

            listener = (e: { data: GatewayMessage<any> }) => {
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
                            });
                            if (this.isPaused) {
                                this.pause();
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
                                this.isCancelling = false;
                                return;
                            } else {
                                this.isCancelling = false;
                                throw new Error("Shift cancelled by user");
                            }
                        case GatewayMessageType.Done:
                            close();
                            return e.data.payload;
                    }
                }
            };

            window.addEventListener('message', listener);

            const overlay = document.querySelector('._ren_overlay');
            if (overlay) {
                (overlay as any).onclick = () => {
                    this.pause();
                };
            }

        })().then(this.promiEvent.resolve).catch(this.promiEvent.reject);

        return this;
    }

    public result = () => this.promiEvent;
};



////////////////////////////////////////////////////////////////////////////////
// EXPORTS                                                                    //
// Based on https://github.com/MikeMcl/bignumber.js/blob/master/bignumber.js  //
////////////////////////////////////////////////////////////////////////////////

// tslint:disable: no-object-mutation

// tslint:disable-next-line: no-string-literal
(GatewayJS as any)["default"] = (GatewayJS as any).GatewayJS = GatewayJS;

declare global {
    let define: any;
    // let module: any;
}
if (typeof define === 'function' && define.amd) {
    // AMD.
    define(() => GatewayJS);

} else if (typeof module !== "undefined" && module.exports) {
    // Node.js and other environments that support module.exports.
    try {
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
