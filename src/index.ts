import { RenElementHTML, RenGatewayContainerHTML } from "./ren";

// tslint:disable

const GATEWAY_ENDPOINT = "https://gateway-js.herokuapp.com/";

export interface Commitment {
    sendToken: string;
    sendTo: string;
    sendAmount: number;
    contractFn: string;
    contractParams: Array<{ name: string, value: string | number, type: string }>;
    nonce: string;
}

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

// const GATEWAY_URL = "http://localhost:3344/";

export class GatewayJS {
    // Each GatewayJS instance has a unique ID
    private id: string;
    private endpoint: string;
    public paused = false;

    // FIXME: Passing in an endpoint is great for development but probably not very secure
    constructor(endpoint?: string) {
        this.id = String(Math.random()).slice(2); // TODO: Generate UUID properly
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

    private sendMessage = (type: string, payload: any, iframeIn?: ChildNode) => {
        const frame = iframeIn || this.getIFrame();
        if (frame) {
            (frame as any).contentWindow.postMessage({ from: "ren", frameID: this.id, type, payload }, '*');
        }
    }


    public close = () => {
        try {
            const renElement = this.getPopup();
            if (renElement.parentElement) {
                renElement.parentElement.removeChild(renElement);
            }
        } catch (error) {
            console.error(error);
        }
    }

    private _pause = () => {
        this.paused = true;
        this.getPopup().classList.add("_ren_gateway-minified");
    }

    private _resume = () => {
        this.paused = false;
        this.getPopup().classList.remove("_ren_gateway-minified");
    }

    public pause = () => {
        this.sendMessage("pause", {});
        this._pause();
        return this;
    }

    public resume = () => {
        this.sendMessage("resume", {});
        this._resume();
        return this;
    }

    public unfinishedTrades = async () => new Promise((resolve, reject) => {
        const container = this.getOrCreateGatewayContainer();

        const iframe = (uniqueID: string, iframeURL: string) => `
        <iframe class="_ren_iframe-hidden" id="_ren_iframe-hidden-${uniqueID}" style="display: none"
            src="${iframeURL}/unfinished" ></iframe>
        `

        const popup = createElementFromHTML(iframe(this.id, this.endpoint));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        let listener: (e: any) => void;

        const close = () => {
            if (popup) {
                window.removeEventListener("message", listener);
                container.removeChild(popup);
            }
        }

        listener = (e: any) => {
            if (e.data && e.data.from === "ren") {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        if (popup) {
                            this.sendMessage("getTrades", { frameID: this.id }, popup);
                        }
                        break;
                    case "trades":
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

    public open = async (params: Commitment) => new Promise((resolve, reject) => {

        // Check that GatewayJS isn't already open
        let existingPopup;
        try { existingPopup = this.getPopup(); } catch (error) { /* Ignore error */ }
        if (existingPopup) { throw new Error("GatewayJS already open"); }

        const container = this.getOrCreateGatewayContainer();

        const popup = createElementFromHTML(RenElementHTML(this.id, this.endpoint));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        window.addEventListener('message', (e: any) => {
            if (e.data && e.data.from === "ren") {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        this.sendMessage("shift", {
                            frameID: this.id,
                            sendToken: params.sendToken,
                            sendTo: params.sendTo,
                            sendAmount: params.sendAmount,
                            contractFn: params.contractFn,
                            contractParams: params.contractParams,
                            nonce: params.nonce,
                        });
                        if (this.paused) {
                            this.pause();
                        }
                        break;
                    case "pause":
                        if (e.data.frameID === this.id) {
                            this._pause();
                        }
                        break;
                    case "resume":
                        if (e.data.frameID === this.id) {
                            this._resume();
                        }
                        break;
                    case "cancel":
                        if (e.data.frameID === this.id) {
                            this.close();
                            reject(e.data.payload);
                        }
                        break;
                    case "done":
                        if (e.data.frameID === this.id) {
                            this.close();
                            resolve(e.data.payload);
                        }
                        break;
                }
            }
        });

        const overlay = document.querySelector('._ren_overlay');
        if (overlay) {
            (overlay as any).onclick = () => {
                this.pause();
            };
        }
    })
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
    let module: any;
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
