// Example TypeScript file demonstrating the new i18n format

// Simple property access
const title1 = t($ => $.labels.title);
// Will show: "Hello World" (en) or "Hola Mundo" (es)

// With bracket notation for keys with special characters
const title2 = t($ => $.labels.['max-payment'].title);
// Will show: "Maximum Payment" (en) or "Pago Máximo" (es)

// Nested properties
const title3 = t($ => $.common.labels.maxPayment.title);
// Will show: "Max Payment" (en) or "Pago Máximo" (es)

// Multiple bracket notations
const title4 = t($ => $.labels.['max-payment'].['sub-key'].title);
// Will show: "Sub Title" (en) or "Subtítulo" (es)

// Mixed notation
const title6 = t($ => $.namespace.['key-name'].property);
// Will show: "Value" (en) or "Valor" (es)
