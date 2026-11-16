async function setup() {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
}
chrome.runtime.onInstalled.addListener(() => { setup().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { setup().catch(console.error); });
