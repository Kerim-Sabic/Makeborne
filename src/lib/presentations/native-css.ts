/** Identical canvas rules for the account preview and trusted HTML/PDF renderer. */
export const NATIVE_SLIDE_CSS = `
.ap-native-slide{position:relative;container-type:inline-size;aspect-ratio:16/9;width:100%;overflow:hidden;box-sizing:border-box;background:var(--native-paper,#F8F7F4);color:var(--native-ink,#16181D);font-family:Arial,sans-serif}
.ap-native-slide .ap-native-text{position:absolute;box-sizing:border-box;white-space:pre-wrap;overflow:hidden;overflow-wrap:anywhere;margin:0;padding:0;letter-spacing:normal;color:inherit;font-weight:400}
.ap-native-slide .ap-native-title{font-family:var(--native-heading,Arial,sans-serif);font-weight:500;letter-spacing:-.035em}
.ap-native-slide .ap-native-folio{font-family:Arial,sans-serif;text-align:right;color:var(--native-accent,currentColor)}
.ap-native-image{position:absolute;overflow:hidden}
.ap-native-image img{display:block;width:100%;height:100%;max-height:none;object-fit:var(--native-image-fit,contain)}
.ap-native-image .ap-artwork{width:100%;height:100%;margin:0}
.ap-native-image .ap-placeholder{box-sizing:border-box;margin:0;width:100%;height:100%}
`;
