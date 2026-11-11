export type Theme = "light" | "dark";

export const THEME_STORAGE_KEY = "theme";

export function parseTheme(value: string | null | undefined): Theme {
  return value === "dark" ? "dark" : "light";
}

/** 放在 <head> 里、首屏绘制前同步执行，暗色用户才不会先看到一帧亮色。 */
export const themeInitScript = `try{var d=document.documentElement,t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)})==="dark"?"dark":"light";d.classList.toggle("dark",t==="dark");d.style.colorScheme=t}catch(e){}`;
