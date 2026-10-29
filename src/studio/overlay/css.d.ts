// The capture script imports its stylesheets as text (esbuild's text loader, build.mjs) to put them in its shadow root.
declare module "*.css" {
  const text: string;
  export default text;
}
