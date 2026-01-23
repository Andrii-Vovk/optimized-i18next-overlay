// Example file to test key detection

// Simple property access
const title1 = t($ => $.labels.title);

// With bracket notation
const title2 = t($ => $.labels.['max-payment'].title);

// Nested properties
const title3 = t($ => $.common.labels.maxPayment.title);

// Multiple bracket notations
const title4 = t($ => $.labels.['max-payment'].['sub-key'].title);

// With spaces
const title5 = t($ => $.labels.['max payment'].title);

// Mixed notation
const title6 = t($ => $.namespace.['key-name'].property);
