#!/usr/bin/env python3
"""
Pump.fun Token Scraper
Scrapes new tokens from pump.fun with market cap filters and extracts top liquidity holder information.
"""

import time
import json
from datetime import datetime
from selenium import webdriver
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from selenium.common.exceptions import TimeoutException, NoSuchElementException
from webdriver_manager.chrome import ChromeDriverManager

# Configuration
MIN_MARKET_CAP = 20000
MAX_MARKET_CAP = 1000000
BASE_URL = "https://pump.fun/?tab=created_timestamp"
OUTPUT_FILE = "pump-fun-scraped-tokens.json"
MAX_COINS_TO_SCRAPE = 3  # Set to a number to limit scraping (e.g., 5 for testing), None for all

class PumpFunScraper:
    def __init__(self):
        self.driver = None
        self.scraped_tokens = []
        self.setup_driver()
    
    def setup_driver(self):
        """Setup Chrome driver with visible browser"""
        chrome_options = Options()
        # Keep browser visible (don't use headless mode)
        # chrome_options.add_argument("--headless")  # Commented out for visibility
        chrome_options.add_argument("--start-maximized")
        chrome_options.add_argument("--disable-blink-features=AutomationControlled")
        chrome_options.add_experimental_option("excludeSwitches", ["enable-automation"])
        chrome_options.add_experimental_option('useAutomationExtension', False)
        
        # Initialize driver
        service = Service(ChromeDriverManager().install())
        self.driver = webdriver.Chrome(service=service, options=chrome_options)
        self.driver.implicitly_wait(10)
        print("✅ Browser opened successfully")
    
    def navigate_to_page(self):
        """Navigate to pump.fun with created_timestamp tab"""
        print(f"\n🌐 Navigating to: {BASE_URL}")
        self.driver.get(BASE_URL)
        # Wait longer for React/Next.js app to load
        print("⏳ Waiting for page to fully load...")
        time.sleep(8)  # Increased wait time for dynamic content
        # Wait for page to be interactive
        WebDriverWait(self.driver, 15).until(
            lambda d: d.execute_script("return document.readyState") == "complete"
        )
        time.sleep(3)  # Additional wait for React hydration
        print("✅ Page loaded")
    
    def apply_filters(self):
        """Click filters button and set market cap range"""
        print("\n🔍 Applying filters...")
        
        try:
            # Wait a bit more for page to be fully interactive
            time.sleep(3)
            # Find and click the filters button
            # The filters button might be in different locations, let's try common selectors
            filter_selectors = [
                "button[class*='filter']",
                "button:contains('Filter')",
                "//button[contains(text(), 'Filter')]",
                "//button[contains(text(), 'Filters')]",
                "button[aria-label*='filter' i]",
                "//div[contains(@class, 'filter')]//button",
            ]
            
            filter_button = None
            for selector in filter_selectors:
                try:
                    if selector.startswith("//"):
                        filter_button = self.driver.find_element(By.XPATH, selector)
                    else:
                        filter_button = self.driver.find_element(By.CSS_SELECTOR, selector)
                    if filter_button:
                        break
                except:
                    continue
            
            if not filter_button:
                # Try to find any button that might be the filter button
                print("  🔍 Searching all buttons for filter button...")
                buttons = self.driver.find_elements(By.TAG_NAME, "button")
                print(f"  Found {len(buttons)} total buttons")
                for btn in buttons:
                    btn_text = btn.text.lower()
                    btn_aria = (btn.get_attribute("aria-label") or "").lower()
                    btn_class = (btn.get_attribute("class") or "").lower()
                    if "filter" in btn_text or "filter" in btn_aria or "filter" in btn_class:
                        filter_button = btn
                        print(f"  ✅ Found filter button with text: '{btn.text}'")
                        break
            
            if filter_button:
                try:
                    # Scroll to button first
                    self.driver.execute_script("arguments[0].scrollIntoView(true);", filter_button)
                    time.sleep(1)
                    self.driver.execute_script("arguments[0].click();", filter_button)
                    print("✅ Filter button clicked")
                    # Wait for filter popover/modal to appear
                    print("  ⏳ Waiting for filter popover to appear...")
                    time.sleep(4)  # Wait for popover animation
                    
                    # Try to wait for the popover to be visible
                    try:
                        WebDriverWait(self.driver, 5).until(
                            EC.presence_of_element_located((By.XPATH, "//div[@role='dialog' or contains(@class, 'popover') or contains(@data-side, 'bottom')]"))
                        )
                        print("  ✅ Filter popover appeared")
                    except:
                        print("  ⚠️  Popover detection timeout, continuing anyway...")
                except Exception as e:
                    print(f"  ⚠️  Error clicking filter button: {e}")
                    # Try regular click as fallback
                    try:
                        filter_button.click()
                        time.sleep(4)
                    except:
                        print("  ❌ Could not click filter button")
            else:
                print("⚠️  Could not find filter button, trying alternative approach...")
                # Try to find filter icon or any element with filter-related classes
                try:
                    filter_icons = self.driver.find_elements(By.XPATH, "//*[contains(@class, 'filter') or contains(@aria-label, 'filter')]")
                    if filter_icons:
                        print(f"  Found {len(filter_icons)} filter-related elements, trying to click first one...")
                        self.driver.execute_script("arguments[0].click();", filter_icons[0])
                        time.sleep(3)
                except:
                    pass
                
                # Try clicking on any element that might open filters
                # Sometimes filters are in a dropdown or menu
                self.driver.execute_script("window.scrollTo(0, 0);")
                time.sleep(1)
            
            # Wait for filter popover/modal to appear
            time.sleep(2)
            
            # Find the market cap input fields
            # Based on the image, there should be "Minimum" and "Maximum" inputs
            print("🔧 Setting market cap values...")
            
            # Try to find inputs with placeholder "$20.0K" and "$1.0M" or labels "Minimum" and "Maximum"
            inputs = self.driver.find_elements(By.TAG_NAME, "input")
            
            min_input = None
            max_input = None
            
            for inp in inputs:
                placeholder = inp.get_attribute("placeholder") or ""
                # Check if it's near a "Minimum" label
                try:
                    parent = inp.find_element(By.XPATH, "./ancestor::div[contains(@class, 'grid')]")
                    labels = parent.find_elements(By.TAG_NAME, "label")
                    for label in labels:
                        if "minimum" in label.text.lower():
                            min_input = inp
                            break
                except:
                    pass
                
                if not min_input and ("20" in placeholder.lower() or "k" in placeholder.lower()):
                    # Check if there's a "Minimum" label nearby
                    try:
                        # Look for label with "Minimum" text
                        xpath = f"//label[contains(text(), 'Minimum')]/following-sibling::input | //label[contains(text(), 'Minimum')]/../input"
                        min_input = self.driver.find_element(By.XPATH, xpath)
                    except:
                        pass
            
            # Find maximum input
            for inp in inputs:
                placeholder = inp.get_attribute("placeholder") or ""
                try:
                    parent = inp.find_element(By.XPATH, "./ancestor::div[contains(@class, 'grid')]")
                    labels = parent.find_elements(By.TAG_NAME, "label")
                    for label in labels:
                        if "maximum" in label.text.lower():
                            max_input = inp
                            break
                except:
                    pass
                
                if not max_input and ("1.0m" in placeholder.lower() or "1m" in placeholder.lower()):
                    try:
                        xpath = f"//label[contains(text(), 'Maximum')]/following-sibling::input | //label[contains(text(), 'Maximum')]/../input"
                        max_input = self.driver.find_element(By.XPATH, xpath)
                    except:
                        pass
            
            # Alternative: Find by position (first input = min, second = max)
            if not min_input or not max_input:
                grid_inputs = self.driver.find_elements(By.CSS_SELECTOR, "div[class*='grid'] input[type='text']")
                if len(grid_inputs) >= 2:
                    min_input = grid_inputs[0]
                    max_input = grid_inputs[1]
            
            if min_input:
                try:
                    # Wait for input to be interactable
                    WebDriverWait(self.driver, 5).until(EC.element_to_be_clickable(min_input))
                    # Use JavaScript to set value if regular interaction fails
                    try:
                        min_input.clear()
                        min_input.send_keys(str(MIN_MARKET_CAP))
                    except:
                        # Fallback to JavaScript
                        self.driver.execute_script("arguments[0].value = arguments[1];", min_input, str(MIN_MARKET_CAP))
                        # Trigger input event
                        self.driver.execute_script("arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", min_input)
                        self.driver.execute_script("arguments[0].dispatchEvent(new Event('change', { bubbles: true }));", min_input)
                    print(f"✅ Set minimum market cap to: ${MIN_MARKET_CAP:,}")
                    time.sleep(0.5)
                except Exception as e:
                    print(f"⚠️  Could not set minimum input: {e}")
            else:
                print("⚠️  Could not find minimum input field")
            
            if max_input:
                try:
                    # Wait for input to be interactable
                    WebDriverWait(self.driver, 5).until(EC.element_to_be_clickable(max_input))
                    # Use JavaScript to set value if regular interaction fails
                    try:
                        max_input.clear()
                        max_input.send_keys(str(MAX_MARKET_CAP))
                    except:
                        # Fallback to JavaScript
                        self.driver.execute_script("arguments[0].value = arguments[1];", max_input, str(MAX_MARKET_CAP))
                        # Trigger input event
                        self.driver.execute_script("arguments[0].dispatchEvent(new Event('input', { bubbles: true }));", max_input)
                        self.driver.execute_script("arguments[0].dispatchEvent(new Event('change', { bubbles: true }));", max_input)
                    print(f"✅ Set maximum market cap to: ${MAX_MARKET_CAP:,}")
                    time.sleep(0.5)
                except Exception as e:
                    print(f"⚠️  Could not set maximum input: {e}")
            else:
                print("⚠️  Could not find maximum input field")
            
            # Find and click Apply button
            apply_selectors = [
                "button:contains('Apply')",
                "//button[contains(text(), 'Apply')]",
                "button[type='submit']",
            ]
            
            apply_button = None
            for selector in apply_selectors:
                try:
                    if selector.startswith("//"):
                        apply_button = self.driver.find_element(By.XPATH, selector)
                    else:
                        apply_button = self.driver.find_element(By.CSS_SELECTOR, selector)
                    if apply_button:
                        break
                except:
                    continue
            
            if apply_button:
                self.driver.execute_script("arguments[0].click();", apply_button)
                print("✅ Filters applied")
                time.sleep(3)  # Wait for filters to apply
            else:
                print("⚠️  Could not find Apply button, filters may have auto-applied")
                time.sleep(2)
                
        except Exception as e:
            print(f"❌ Error applying filters: {e}")
            import traceback
            traceback.print_exc()
            print("⚠️  Continuing anyway...")
            # Save page source for debugging
            try:
                with open("pump-fun-page-source.html", "w", encoding="utf-8") as f:
                    f.write(self.driver.page_source)
                print("  💾 Saved page source to pump-fun-page-source.html for debugging")
            except:
                pass
    
    def get_coin_list(self):
        """Get list of coins from the current page"""
        print("\n📋 Getting list of coins...")
        coins = []
        
        try:
            # Wait for coins to load
            time.sleep(5)
            
            # Try multiple strategies to find coin links
            print("  🔍 Searching for coin links...")
            
            # Strategy 1: Find all links containing /coin/
            try:
                all_links = self.driver.find_elements(By.TAG_NAME, "a")
                print(f"  Found {len(all_links)} total links on page")
                
                for link in all_links:
                    try:
                        href = link.get_attribute("href")
                        if href and "/coin/" in href:
                            coin_address = href.split("/coin/")[-1].split("?")[0].split("#")[0]
                            # Validate it looks like a Solana address (base58, typically 32-44 chars)
                            if coin_address and len(coin_address) >= 32 and coin_address not in [c.get("address") for c in coins]:
                                coins.append({
                                    "address": coin_address,
                                    "element": link,
                                    "href": href
                                })
                    except:
                        continue
            except Exception as e:
                print(f"  ⚠️  Error with link strategy: {e}")
            
            # Strategy 2: Try XPath for coin links
            if not coins:
                try:
                    xpath_links = self.driver.find_elements(By.XPATH, "//a[contains(@href, '/coin/')]")
                    print(f"  Found {len(xpath_links)} links via XPath")
                    for link in xpath_links:
                        try:
                            href = link.get_attribute("href")
                            if href:
                                coin_address = href.split("/coin/")[-1].split("?")[0].split("#")[0]
                                if coin_address and len(coin_address) >= 32 and coin_address not in [c.get("address") for c in coins]:
                                    coins.append({
                                        "address": coin_address,
                                        "element": link,
                                        "href": href
                                    })
                        except:
                            continue
                except Exception as e:
                    print(f"  ⚠️  Error with XPath strategy: {e}")
            
            # Strategy 3: Look for clickable divs or cards that might contain coin info
            if not coins:
                try:
                    # Look for elements that might be coin cards
                    clickable_divs = self.driver.find_elements(By.XPATH, "//div[@role='button' or @onclick or contains(@class, 'cursor-pointer')]")
                    print(f"  Found {len(clickable_divs)} potentially clickable divs")
                    # This is a fallback - we'd need to inspect these more carefully
                except:
                    pass
            
            # Remove duplicates
            seen_addresses = set()
            unique_coins = []
            for coin in coins:
                if coin["address"] not in seen_addresses:
                    seen_addresses.add(coin["address"])
                    unique_coins.append(coin)
            
            coins = unique_coins
            print(f"✅ Found {len(coins)} unique coins on this page")
            
            if coins:
                print(f"  Sample addresses: {[c['address'][:16] + '...' for c in coins[:3]]}")
            
            return coins
            
        except Exception as e:
            print(f"❌ Error getting coin list: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def scrape_coin_details(self, coin_address, coin_element):
        """Click on a coin and scrape its details, especially top liquidity holder"""
        print(f"\n🪙 Scraping coin: {coin_address[:8]}...")
        
        token_data = {
            "address": coin_address,
            "scraped_at": datetime.now().isoformat(),
            "top_liquidity_holder": None,
            "liquidity_holder_address": None,
            "liquidity_percentage": None,
        }
        
        try:
            # Store current window handle
            main_window = self.driver.current_window_handle
            
            # Click on the coin (open in new tab or same tab)
            self.driver.execute_script("arguments[0].click();", coin_element)
            time.sleep(3)  # Wait for page to load
            
            # If a new tab opened, switch to it
            if len(self.driver.window_handles) > 1:
                for handle in self.driver.window_handles:
                    if handle != main_window:
                        self.driver.switch_to.window(handle)
                        break
            
            # Wait for page to load
            time.sleep(3)
            
            # Scroll to find "Top holders" section
            print("  📊 Looking for 'Top holders' section...")
            self.driver.execute_script("window.scrollTo(0, document.body.scrollHeight);")
            time.sleep(1)
            self.driver.execute_script("window.scrollTo(0, 0);")
            time.sleep(1)
            
            # Find "Top holders" section
            top_holders_selectors = [
                "//*[contains(text(), 'Top holders')]",
                "//*[contains(text(), 'Top Holders')]",
                "//*[contains(text(), 'top holders')]",
                "div[class*='holder']",
            ]
            
            top_holders_section = None
            for selector in top_holders_selectors:
                try:
                    if selector.startswith("//"):
                        elements = self.driver.find_elements(By.XPATH, selector)
                    else:
                        elements = self.driver.find_elements(By.CSS_SELECTOR, selector)
                    
                    for elem in elements:
                        if "holder" in elem.text.lower():
                            top_holders_section = elem
                            break
                    
                    if top_holders_section:
                        break
                except:
                    continue
            
            if top_holders_section:
                print("  ✅ Found 'Top holders' section")
                
                # Scroll to the section
                self.driver.execute_script("arguments[0].scrollIntoView(true);", top_holders_section)
                time.sleep(2)
                
                # Find the first holder (which should be the liquidity pool)
                # Based on the image, the first entry is "Liquidity pool" with a percentage
                try:
                    import re
                    
                    # Strategy 1: Look for links containing holder addresses
                    holder_elements = top_holders_section.find_elements(By.XPATH, ".//a[contains(@href, '/profile/')]")
                    
                    if not holder_elements:
                        # Strategy 2: Look for any links in the section
                        holder_elements = top_holders_section.find_elements(By.TAG_NAME, "a")
                    
                    if holder_elements:
                        print(f"  Found {len(holder_elements)} potential holder links")
                        # Get the first holder (liquidity pool or top holder)
                        first_holder = holder_elements[0]
                        holder_text = first_holder.text.strip()
                        holder_href = first_holder.get_attribute("href")
                        
                        # Extract address from href if available
                        if holder_href and "/profile/" in holder_href:
                            address = holder_href.split("/profile/")[-1].split("?")[0].split("#")[0]
                            token_data["liquidity_holder_address"] = address
                            print(f"  Extracted address from href: {address[:16]}...")
                        
                        # Try to find the percentage - look in parent containers
                        try:
                            # Get the parent container that should have both the link and percentage
                            parent = first_holder.find_element(By.XPATH, "./ancestor::div[contains(@class, 'flex') or contains(@class, 'grid')][1]")
                            percentage_text = parent.text
                            
                            # Look for percentage pattern (e.g., "14.51%")
                            percentage_match = re.search(r'(\d+\.?\d*)\s*%', percentage_text)
                            if percentage_match:
                                token_data["liquidity_percentage"] = percentage_match.group(1)
                                print(f"  Found percentage: {token_data['liquidity_percentage']}%")
                            
                            # If we don't have holder text from the link, try to get it from parent
                            if not holder_text or len(holder_text) < 3:
                                # Look for text that might be the holder name (e.g., "Liquidity pool")
                                all_text = parent.text
                                lines = [line.strip() for line in all_text.split('\n') if line.strip()]
                                for line in lines:
                                    if line and not re.match(r'^\d+\.?\d*\s*%$', line) and '%' not in line:
                                        holder_text = line
                                        break
                        except Exception as e:
                            print(f"  ⚠️  Error finding percentage: {e}")
                            # Try alternative: search entire section text
                            section_text = top_holders_section.text
                            percentage_match = re.search(r'(\d+\.?\d*)\s*%', section_text)
                            if percentage_match:
                                token_data["liquidity_percentage"] = percentage_match.group(1)
                        
                        token_data["top_liquidity_holder"] = holder_text if holder_text else "Unknown"
                        print(f"  ✅ Found top liquidity holder: {token_data['top_liquidity_holder']}")
                        if token_data["liquidity_percentage"]:
                            print(f"     Percentage: {token_data['liquidity_percentage']}%")
                        if token_data["liquidity_holder_address"]:
                            print(f"     Address: {token_data['liquidity_holder_address'][:16]}...")
                    else:
                        # Alternative: parse the entire section text
                        section_text = top_holders_section.text
                        print(f"  📝 Section text: {section_text[:300]}...")
                        
                        # Try to extract information from text
                        lines = [line.strip() for line in section_text.split('\n') if line.strip()]
                        for i, line in enumerate(lines):
                            if "liquidity" in line.lower() or "pool" in line.lower():
                                # Next line might be percentage or address
                                if i + 1 < len(lines):
                                    next_line = lines[i + 1]
                                    percentage_match = re.search(r'(\d+\.?\d*)\s*%', next_line)
                                    if percentage_match:
                                        token_data["liquidity_percentage"] = percentage_match.group(1)
                                        token_data["top_liquidity_holder"] = line
                                        break
                except Exception as e:
                    print(f"  ⚠️  Error extracting holder details: {e}")
                    import traceback
                    traceback.print_exc()
            else:
                print("  ⚠️  Could not find 'Top holders' section")
            
            # Close the coin page tab and return to main window
            if len(self.driver.window_handles) > 1:
                self.driver.close()
                self.driver.switch_to.window(main_window)
            else:
                # If same tab, go back
                self.driver.back()
                time.sleep(2)
            
            return token_data
            
        except Exception as e:
            print(f"  ❌ Error scraping coin {coin_address}: {e}")
            # Try to return to main window
            try:
                if len(self.driver.window_handles) > 1:
                    for handle in self.driver.window_handles:
                        if handle == main_window:
                            self.driver.switch_to.window(handle)
                            break
                else:
                    self.driver.back()
            except:
                pass
            return token_data
    
    def save_results(self):
        """Save scraped results to JSON file"""
        output = {
            "scraped_at": datetime.now().isoformat(),
            "filters": {
                "min_market_cap": MIN_MARKET_CAP,
                "max_market_cap": MAX_MARKET_CAP,
            },
            "total_tokens": len(self.scraped_tokens),
            "tokens": self.scraped_tokens
        }
        
        with open(OUTPUT_FILE, 'w') as f:
            json.dump(output, f, indent=2)
        
        print(f"\n💾 Results saved to: {OUTPUT_FILE}")
        print(f"📊 Total tokens scraped: {len(self.scraped_tokens)}")
    
    def run(self):
        """Main execution method"""
        try:
            print("=" * 60)
            print("🚀 Pump.fun Token Scraper")
            print("=" * 60)
            
            # Navigate to page
            self.navigate_to_page()
            
            # Apply filters
            self.apply_filters()
            
            # Get list of coins
            coins = self.get_coin_list()
            
            if not coins:
                print("\n⚠️  No coins found. The page structure might have changed.")
                print("📸 Taking a screenshot for debugging...")
                try:
                    self.driver.save_screenshot("pump-fun-page-screenshot.png")
                    print("✅ Screenshot saved as pump-fun-page-screenshot.png")
                except:
                    pass
                
                # Try scrolling to load more content
                print("🔄 Scrolling page to trigger lazy loading...")
                for i in range(3):
                    self.driver.execute_script(f"window.scrollTo(0, {(i+1) * 500});")
                    time.sleep(2)
                
                # Try again
                coins = self.get_coin_list()
                
                if not coins:
                    print("\n❌ Still no coins found. Please check the browser window manually.")
                    print("The page might require manual interaction or the structure has changed.")
                    print("Keeping browser open for 60 seconds for manual inspection...")
                    time.sleep(60)
            
            # Limit coins if MAX_COINS_TO_SCRAPE is set
            if MAX_COINS_TO_SCRAPE and MAX_COINS_TO_SCRAPE > 0:
                coins = coins[:MAX_COINS_TO_SCRAPE]
                print(f"\n⚠️  Limiting to first {len(coins)} coins for testing")
            
            # Scrape each coin
            print(f"\n🔄 Starting to scrape {len(coins)} coins...")
            for i, coin in enumerate(coins, 1):
                print(f"\n[{i}/{len(coins)}] Processing coin...")
                token_data = self.scrape_coin_details(coin["address"], coin["element"])
                self.scraped_tokens.append(token_data)
                
                # Print summary
                print(f"\n📝 Summary for coin {coin['address']}:")
                print(f"   Top Liquidity Holder: {token_data.get('top_liquidity_holder', 'N/A')}")
                print(f"   Holder Address: {token_data.get('liquidity_holder_address', 'N/A')}")
                print(f"   Percentage: {token_data.get('liquidity_percentage', 'N/A')}%")
                
                # Small delay between coins
                time.sleep(2)
            
            # Save results
            self.save_results()
            
            print("\n✅ Scraping completed!")
            print("\n" + "=" * 60)
            
        except KeyboardInterrupt:
            print("\n\n⚠️  Scraping interrupted by user")
            self.save_results()
        except Exception as e:
            print(f"\n❌ Error during scraping: {e}")
            import traceback
            traceback.print_exc()
            self.save_results()
        finally:
            print("\n⏸️  Keeping browser open for 30 seconds for review...")
            time.sleep(30)
            if self.driver:
                self.driver.quit()
                print("✅ Browser closed")

if __name__ == "__main__":
    scraper = PumpFunScraper()
    scraper.run()

