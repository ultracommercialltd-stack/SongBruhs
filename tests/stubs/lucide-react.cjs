const React = require('react');
const icon = (name) => {
  const C = (props) => React.createElement('svg', { ...props, 'data-icon': name });
  C.displayName = name;
  return C;
};
module.exports = new Proxy({}, {
  get: (t, k) => {
    if (k === '__esModule') return true;
    if (typeof k !== 'string') return undefined;
    if (!t[k]) t[k] = icon(k);
    return t[k];
  },
});
