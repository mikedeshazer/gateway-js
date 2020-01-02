import { RenElementHTML, RenGatewayContainerHTML } from "./ren";

// tslint:disable

export interface Commitment {
    sendToken: string;
    sendTo: string;
    sendAmount: number;
    contractFn: string;
    contractParams: Array<{ name: string, value: string, type: string }>;
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

const GATEWAY_URL = "http://localhost:3344/";

class GatewayJS {
    // Each GatewayJS instance has a unique ID
    private id: string;
    public paused = false;

    constructor() {
        this.id = String(Math.random()).slice(2); // TODO: Generate UUID properly
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
            (frame as any).contentWindow.postMessage({ from: "ren", type, payload }, '*');
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
    }

    public resume = () => {
        this.sendMessage("resume", {});
        this._resume();
    }

    public unfinishedTrades = async () => new Promise((resolve, reject) => {
        const container = this.getOrCreateGatewayContainer();

        const iframe = (uniqueID: string, iframeURL: string) => `
        <iframe class="_ren_iframe-hidden" id="_ren_iframe-hidden-${uniqueID}" style="display: none"
            src="${iframeURL}/unfinished" ></iframe>
        `

        const popup = createElementFromHTML(iframe(this.id, GATEWAY_URL));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        const close = () => {
            if (popup) {
                container.removeChild(popup);
            }
        }

        window.onmessage = (e: any) => {
            if (e.data && e.data.from === "ren") {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        if (popup) {
                            this.sendMessage("getTrades", {}, popup);
                        }
                        break;
                    case "trades":
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
    })

    public open = async (params: Commitment) => new Promise((resolve, reject) => {

        // Check that GatewayJS isn't already open
        let existingPopup;
        try { existingPopup = this.getPopup(); } catch (error) { /* Ignore error */ }
        if (existingPopup) { throw new Error("GatewayJS already open"); }

        const container = this.getOrCreateGatewayContainer();

        const popup = createElementFromHTML(RenElementHTML(this.id, GATEWAY_URL));

        if (popup) {
            container.insertBefore(popup, container.lastChild);
        }

        window.onmessage = (e: any) => {
            if (e.data && e.data.from === "ren") {
                // alert(`I got a message: ${JSON.stringify(e.data)}`);
                switch (e.data.type) {
                    case "ready":
                        this.sendMessage("shift", {
                            sendToken: params.sendToken,
                            sendTo: params.sendTo,
                            sendAmount: params.sendAmount,
                            contractFn: params.contractFn,
                            contractParams: params.contractParams,
                        });
                        if (this.paused) {
                            this.pause();
                        }
                        break;
                    case "pause":
                        this._pause();
                        break;
                    case "resume":
                        this._resume();
                        break;
                    case "cancel":
                        this.close();
                        reject(e.data.payload);
                        break;
                    case "done":
                        this.close();
                        resolve(e.data.payload);
                        break;
                }
            }
        };
    })
};

export default GatewayJS;
