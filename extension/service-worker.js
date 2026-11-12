// Clicking the toolbar icon opens the side panel. That click also grants
// activeTab for the current tab, which lets the panel read pages on sites
// that aren't in host_permissions (until the user clicks "Allow on this site").
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});
