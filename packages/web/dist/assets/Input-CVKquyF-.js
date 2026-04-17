import{n,r as m,j as t,c as p}from"./index-DCSOZAR-.js";/**
 * @license lucide-react v0.470.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const h=n("EyeOff",[["path",{d:"M10.733 5.076a10.744 10.744 0 0 1 11.205 6.575 1 1 0 0 1 0 .696 10.747 10.747 0 0 1-1.444 2.49",key:"ct8e1f"}],["path",{d:"M14.084 14.158a3 3 0 0 1-4.242-4.242",key:"151rxh"}],["path",{d:"M17.479 17.499a10.75 10.75 0 0 1-15.417-5.151 1 1 0 0 1 0-.696 10.75 10.75 0 0 1 4.446-5.143",key:"13bj9a"}],["path",{d:"m2 2 20 20",key:"1ooewy"}]]);/**
 * @license lucide-react v0.470.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const y=n("Eye",[["path",{d:"M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0",key:"1nclc0"}],["circle",{cx:"12",cy:"12",r:"3",key:"1v7zrd"}]]);function f({label:a,error:e,helperText:c,isPassword:o=!1,className:l,type:r,...x}){const[s,d]=m.useState(!1),i=o&&!s?"password":r||"text";return t.jsxs("div",{className:"w-full",children:[a&&t.jsx("label",{className:"block text-sm font-medium text-text-primary mb-2",children:a}),t.jsxs("div",{className:"relative",children:[t.jsx("input",{type:i,className:p("input-base",e&&"border-accent-coral focus-visible:border-accent-coral",l),...x}),o&&t.jsx("button",{type:"button",onClick:()=>d(!s),className:"absolute right-3 top-1/2 -translate-y-1/2 text-text-muted hover:text-text-secondary transition-colors","aria-label":s?"Hide password":"Show password",children:s?t.jsx(h,{className:"w-5 h-5"}):t.jsx(y,{className:"w-5 h-5"})})]}),e&&t.jsx("p",{className:"text-sm text-accent-coral mt-1",children:e}),c&&!e&&t.jsx("p",{className:"text-sm text-text-muted mt-1",children:c})]})}export{f as I};
