import { createElement, isValidElement, Dispatch, SetStateAction, ReactNode, CSSProperties } from "react";
import ReactDOMServer from "react-dom/server";

import ChatHistoryLineBreak from "../components/ChatHistoryLineBreak/ChatHistoryLineBreak";
import LoadingSpinner from "../components/LoadingSpinner/LoadingSpinner";
import { Message } from "../types/Message";
import { Options } from "../types/Options";

// variables used to track history, updated when botOptions.chatHistory value changes
let historyLoaded = false;
let historyStorageKey = "rcb-history";
let historyMaxEntries = 30;
let historyDisabled = false;

/**
 * Updates the messages array with a new message appended at the end and saves chat history if enabled.
 * 
 * @param messages messages containing current conversation with the bot
 */
const saveChatHistory = async (messages: Message[], chatHistory: string) => {
	if (historyDisabled) {
		return;
	}
	
	const historyMessages = getHistoryMessages(chatHistory);
	const messagesToSave: Message[] = [];
	const offset = historyLoaded ? historyMessages.length : 0;

	for (let i = messages.length - 1; i >= offset; i--) {
		const message = messages[i];

		if (message.sender === "system") {
			break;
		} else {
			messagesToSave.unshift(message);
		}

		if (messagesToSave.length === historyMaxEntries) {
			break;
		}
	}

	let parsedMessages = messagesToSave.map(parseMessageToString);
	if (parsedMessages.length < historyMaxEntries) {
		const difference = historyMaxEntries - parsedMessages.length;
		parsedMessages = [...historyMessages.slice(-difference), ...parsedMessages]
	}

	localStorage.setItem(historyStorageKey, JSON.stringify(parsedMessages));
}

/**
 * Retrieves chat history.
 * 
 * @param historyStorageKey key used to identify chat history stored in local storage
 */
const getHistoryMessages = (chatHistory: string) => {
	if (chatHistory != null) {
		try {
			return JSON.parse(chatHistory);
		} catch {
			return [];
		}
	}
	return [];
}

/**
 * Sets the currently used history storage key.
 * 
 * @param botOptions options provided to the bot
 */
const setHistoryStorageValues = (botOptions: Options) => {
	historyStorageKey = botOptions.chatHistory?.storageKey as string;
	historyMaxEntries = botOptions.chatHistory?.maxEntries as number;
	historyDisabled = botOptions.chatHistory?.disabled as boolean;
}

/**
 * Parses message into string for chat history storage.
 * 
 * @param message message to parse
 */
const parseMessageToString = (message: Message) => {
	if (isValidElement(message.content)) {
		const clonedMessage = structuredClone({
			content: ReactDOMServer.renderToString(message.content),
			type: "object",
			sender: message.sender,
		});
		return clonedMessage;
	}

	return {...message, type: "string"}
}

/**
 * Loads chat history into the chat window for user view.
 * 
 * @param botOptions options provided to the bot
 * @param chatHistory chat history to show
 * @param setMessages setter for updating messages
 * @param setTextAreaDisabled setter for enabling/disabling user text area
 */
const loadChatHistory = (botOptions: Options, chatHistory: string, setMessages: Dispatch<SetStateAction<Message[]>>, 
	setTextAreaDisabled: Dispatch<SetStateAction<boolean>>) => {

	historyLoaded = true;
	if (chatHistory != null) {
		try {
			setMessages((prevMessages) => {
				const loaderMessage = {
					content: <LoadingSpinner/>,
					sender: "system"
				}
				prevMessages.shift();
				return [loaderMessage, ...prevMessages];
			});

			const parsedMessages = JSON.parse(chatHistory).map((message: Message) => {
				if (message.type === "object") {
					const element = renderHTML(message.content as string, botOptions);
					return { ...message, content: element };
				}
				return message;
			});

			setTimeout(() => {
				setMessages((prevMessages) => {
					prevMessages.shift();
					const lineBreakMessage = {
						content: <ChatHistoryLineBreak/>,
						sender: "system"
					}
					return [...parsedMessages, lineBreakMessage, ...prevMessages];
				});
				setTextAreaDisabled(botOptions.chatInput?.disabled || false);
			}, 500)
		} catch {
			// remove chat history on error (to address corrupted storage values)
			localStorage.removeItem(botOptions.chatHistory?.storageKey as string);
		}
	}
}

/**
 * Renders html string to a react node.
 * 
 * @param html string to render
 * @param botOptions options provided to the bot
 */
const renderHTML = (html: string, botOptions: Options): ReactNode[] => {
	const parser = new DOMParser();
	const parsedHtml = parser.parseFromString(html, "text/html");
	const nodes = Array.from(parsedHtml.body.childNodes);
  
	const renderNodes: ReactNode[] = nodes.map((node, index) => {
		if (node.nodeType === Node.TEXT_NODE) {
			return node.textContent;
		} else {
			const tagName = (node as Element).tagName.toLowerCase();
			let attributes = Array.from((node as Element).attributes).reduce((acc, attr) => {
				const attributeName = attr.name.toLowerCase();
				if (attributeName === "style") {
					const styleProperties = attr.value.split(";").filter(property => property.trim() !== "");
					const styleObject: { [key: string]: string } = {};
					styleProperties.forEach(property => {
						const [key, value] = property.split(":").map(part => part.trim());
						const reactCompliantKey = key.replace(/-([a-z])/g, (match, letter) => letter.toUpperCase());
						styleObject[reactCompliantKey] = value;
					});
					acc[attributeName] = styleObject;
				} else {
					acc[attributeName] = attr.value;
				}
				return acc;
			}, {} as { [key: string]: string | CSSProperties });

			const classList = (node as Element).classList;
			if (botOptions.botBubble?.showAvatar) {
				attributes = addStyleToContainers(classList, attributes);
			}
			attributes = addStyleToOptions(classList, attributes, botOptions);
			attributes = addStyleToCheckboxRows(classList, attributes, botOptions);
			attributes = addStyleToCheckboxNextButton(classList, attributes, botOptions);
			const children = renderHTML((node as Element).innerHTML, botOptions);
			return createElement(tagName, { key: index, ...attributes }, children);
		}
	});
  
	return renderNodes;
};

/**
 * Add styles (that were lost when saving to history) to options container/checkbox container.
 * 
 * @param classList array of classes the element has
 * @param attributes current attributes the element has
 */
const addStyleToContainers = (classList: DOMTokenList, attributes: {[key: string]: string | CSSProperties}) => {
	if (classList.contains("rcb-options-container") || classList.contains("rcb-checkbox-container")) {
		attributes["style"] = {
			...(attributes["style"] as CSSProperties),
			marginLeft: "50px"
		}
	}
	return attributes;
}

/**
 * Add styles (that were lost when saving to history) to options.
 * 
 * @param classList array of classes the element has
 * @param attributes current attributes the element has
 * @param botOptions options provided to the bot
 */
const addStyleToOptions = (classList: DOMTokenList, attributes: {[key: string]: string | CSSProperties},
	botOptions: Options) => {
	if (classList.contains("rcb-options")) {
		attributes["style"] = {
			...(attributes["style"] as CSSProperties),
			color: botOptions.botOptionStyle?.color as string || botOptions.theme?.primaryColor,
			borderColor: botOptions.botOptionStyle?.color as string || botOptions.theme?.primaryColor,
			cursor: `url(${botOptions.theme?.actionDisabledIcon}), auto`
		}
	}
	return attributes;
}

/**
 * Add styles (that were lost when saving to history) to checkbox rows.
 * 
 * @param classList array of classes the element has
 * @param attributes current attributes the element has
 * @param botOptions options provided to the bot
 */
const addStyleToCheckboxRows = (classList: DOMTokenList, attributes: {[key: string]: string | CSSProperties},
	botOptions: Options) => {
	if (classList.contains("rcb-checkbox-row-container")) {
		attributes["style"] = {
			...(attributes["style"] as CSSProperties),
			color: botOptions.botCheckboxRowStyle?.color as string || botOptions.theme?.primaryColor,
			borderColor: botOptions.botCheckboxRowStyle?.color as string || botOptions.theme?.primaryColor,
			cursor: `url(${botOptions.theme?.actionDisabledIcon}), auto`
		}
	}
	return attributes;
}

/**
 * Add styles (that were lost when saving to history) to checkbox next button.
 * 
 * @param classList array of classes the element has
 * @param attributes current attributes the element has
 * @param botOptions options provided to the bot
 */
const addStyleToCheckboxNextButton = (classList: DOMTokenList, attributes: {[key: string]: string | CSSProperties},
	botOptions: Options) => {
	if (classList.contains("rcb-checkbox-next-button")) {
		attributes["style"] = {
			...(attributes["style"] as CSSProperties),
			color: botOptions.botCheckboxNextStyle?.color as string || botOptions.theme?.primaryColor,
			borderColor: botOptions.botCheckboxNextStyle?.color as string || botOptions.theme?.primaryColor,
			cursor: `url(${botOptions.theme?.actionDisabledIcon}), auto`
		}
	}
	return attributes;
}

export {
	saveChatHistory,
	loadChatHistory,
	setHistoryStorageValues
}