from playwright.sync_api import Page, expect, sync_playwright
import os

def verify_plugin_ui(page: Page):
    # Get absolute path to ui.html
    ui_path = "file://" + os.path.abspath("ui.html")
    page.goto(ui_path)

    # 1. Verify Initial State (AI Bridge tab)
    expect(page.get_by_text("Enable MCP Bridge")).to_be_visible()
    page.screenshot(path="/home/jules/verification/v2_initial.png")

    # 2. Test Minimize
    page.get_by_title("Minimize").click()
    # Check if minimized bar is visible (it has class minimized-bar and is displayed when body has minimized class)
    # We can check body class
    expect(page.locator("body")).to_have_class("minimized")
    page.screenshot(path="/home/jules/verification/v2_minimized.png")

    # 3. Test Expand
    page.locator("#minimized-expand-btn").click()
    expect(page.locator("body")).not_to_have_class("minimized")

    # 4. Test Tab Switching (Paste HTML)
    page.get_by_role("button", name="Paste HTML").click()
    expect(page.get_by_text("HTML Source")).to_be_visible()

    # Fill some data
    page.locator("#html-input").fill("<h1>Hello World</h1>")
    page.locator("#css-input").fill("h1 { color: red; }")
    page.screenshot(path="/home/jules/verification/v2_paste_tab.png")

    # 5. Test Tab Switching (Upload / URL)
    page.get_by_role("button", name="Upload / URL").click()
    expect(page.get_by_text("Live URL")).to_be_visible()
    page.screenshot(path="/home/jules/verification/v2_upload_tab.png")

if __name__ == "__main__":
    if not os.path.exists("/home/jules/verification"):
        os.makedirs("/home/jules/verification")
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page()
        try:
            verify_plugin_ui(page)
        finally:
            browser.close()
