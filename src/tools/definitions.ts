import type { ToolDefinition } from '../llm/types.js';

/**
 * All tool definitions in OpenAI function-calling JSON Schema format.
 * The agent uses these to decide which action to take.
 */
export const toolDefinitions: ToolDefinition[] = [
    {
        type: 'function',
        function: {
            name: 'navigate',
            description: 'Navigate the browser to a specific URL. Use this to go to websites.',
            parameters: {
                type: 'object',
                properties: {
                    url: {
                        type: 'string',
                        description: 'The URL to navigate to (e.g. "https://google.com" or "yandex.ru")',
                    },
                },
                required: ['url'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'click',
            description:
                'Click on an element on the page. Use the role and name from the accessibility tree. ' +
                'Examples: button "Submit", link "Home", combobox "Search". Also supports text=Label, placeholder=Search, or CSS selectors like #id.',
            parameters: {
                type: 'object',
                properties: {
                    selector: {
                        type: 'string',
                        description: 'Selector for the element to click',
                    },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'type',
            description:
                'Type text into an input field. First specify the selector for the input, then the text to type. ' +
                'This clears the existing value first. Use selectors like combobox "Search", textbox "Email", or placeholder=Search.',
            parameters: {
                type: 'object',
                properties: {
                    selector: {
                        type: 'string',
                        description: 'Selector for the input field',
                    },
                    text: {
                        type: 'string',
                        description: 'Text to type into the field',
                    },
                },
                required: ['selector', 'text'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'scroll',
            description: 'Scroll the page up or down to see more content.',
            parameters: {
                type: 'object',
                properties: {
                    direction: {
                        type: 'string',
                        enum: ['up', 'down'],
                        description: 'Direction to scroll',
                    },
                },
                required: ['direction'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'read_page',
            description:
                'Re-read the current page content. Use this after actions that change the page ' +
                '(like clicking or scrolling) to get the updated accessibility tree.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'go_back',
            description: 'Go back to the previous page in browser history.',
            parameters: {
                type: 'object',
                properties: {},
                required: [],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'select_option',
            description: 'Select an option from a dropdown/select element.',
            parameters: {
                type: 'object',
                properties: {
                    selector: {
                        type: 'string',
                        description: 'Selector for the select element',
                    },
                    value: {
                        type: 'string',
                        description: 'Value or label of the option to select',
                    },
                },
                required: ['selector', 'value'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'press_key',
            description:
                'Press a keyboard key. Useful for Enter, Tab, Escape, or keyboard shortcuts. ' +
                'Examples: "Enter", "Tab", "Escape", "Backspace", "ArrowDown"',
            parameters: {
                type: 'object',
                properties: {
                    key: {
                        type: 'string',
                        description: 'Key to press (e.g. "Enter", "Tab", "Escape")',
                    },
                },
                required: ['key'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'hover',
            description: 'Hover over an element. Useful for revealing dropdown menus or tooltips.',
            parameters: {
                type: 'object',
                properties: {
                    selector: {
                        type: 'string',
                        description: 'Selector for the element to hover over',
                    },
                },
                required: ['selector'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'wait',
            description: 'Wait for a specified time. Useful when a page is loading dynamically.',
            parameters: {
                type: 'object',
                properties: {
                    ms: {
                        type: 'number',
                        description: 'Milliseconds to wait (max 10000)',
                    },
                },
                required: ['ms'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'ask_user',
            description:
                'Ask the user a question when you need clarification or additional information to continue. ' +
                'Use this when the task is ambiguous or you need user input (e.g., choosing between options).',
            parameters: {
                type: 'object',
                properties: {
                    question: {
                        type: 'string',
                        description: 'The question to ask the user',
                    },
                },
                required: ['question'],
            },
        },
    },
    {
        type: 'function',
        function: {
            name: 'done',
            description:
                'Signal that the task is complete. Provide a summary of what was accomplished.',
            parameters: {
                type: 'object',
                properties: {
                    summary: {
                        type: 'string',
                        description: 'Summary of what was accomplished during the task',
                    },
                },
                required: ['summary'],
            },
        },
    },
];
