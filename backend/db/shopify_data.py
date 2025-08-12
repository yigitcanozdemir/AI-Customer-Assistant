# ======================================================
# This script fetches and cleans product data from a Shopify store,
# NOTE: You need to use jupyter interactive window to run this script
# Also this are experimental scripts, not universal
# ======================================================
import requests
import json
import os
from bs4 import BeautifulSoup


# ======================================================
# Function to clean the body_html (products description) of products.json
# ======================================================
def clean_body_html(raw_text: str) -> str:
    lines = raw_text.strip().split("\n")
    parsed = []
    current_title = None
    current_items = []

    section_titles = ["details", "material and care", "size and fit"]

    for line in lines:
        line = line.strip()
        if not line:
            continue

        if line.lower() in section_titles:
            if current_title and current_items:
                parsed.append(f"{current_title}:\n- " + "\n- ".join(current_items))
                current_items = []
            current_title = line
        else:
            current_items.append(line)

    if current_title and current_items:
        parsed.append(f"{current_title}:\n- " + "\n- ".join(current_items))

    return "\n\n".join(parsed)


# ======================================================
# Function to fetch products.json from a Shopify store
# ======================================================
def fetch_and_clean_products(name: str):
    print(f"Fetching from: https://{name}.com/products.json")
    res = requests.get(f"https://{name}.com/products.json")
    data = res.json()
    all_products = []
    page = 1
    limit = 250
    while True:
        url = f"https://{name}.com/products.json?limit={limit}&page={page}"
        print(f"Fetching page {page}...")
        res = requests.get(url)
        data = res.json()
        products = data.get("products", [])

        if not products:
            break

        for product in products:
            html = product.get("body_html", "")
            text = BeautifulSoup(html, "html.parser").get_text().strip()
            cleaned = clean_body_html(text)
            product["body_html"] = cleaned

        all_products.extend(products)
        page += 1

    output_path = f"jsons/{name}_cleaned.json"
    os.makedirs("jsons", exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"products": all_products}, f, indent=2, ensure_ascii=False)

    print(f"Cleaned {len(all_products)} products written to {output_path}")


fetch_and_clean_products("pinklily")


# ======================================================
# Function to fetch and clean policy sections from a Shopify store
# ======================================================


def fetch_policy_sections(url):
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    details_list = soup.select("div.accordion details")

    sections = []

    for details in details_list:
        h3 = details.find("h3")
        title = h3.get_text(strip=True) if h3 else "No Title"

        content_div = details.find("div", class_="accordion__content rte")

        if content_div:
            for a in content_div.find_all("a"):
                a.decompose()

            lines = [
                line.strip()
                for line in content_div.get_text("\n").split("\n")
                if line.strip()
            ]

            formatted_lines = []
            for line in lines:

                formatted_lines.append(f"- {line}")

            content_text = "\n".join(formatted_lines)

            sections.append({"title": title, "content": content_text})

    return sections


if __name__ == "__main__":
    url = "https://pinklily.com/pages/return-exchange-policy"
    sections = fetch_policy_sections(url)

    print(json.dumps(sections, indent=2, ensure_ascii=False))


# ======================================================
# Function to fetch and clean shipping policy from a Shopify store
# ======================================================


def fetch_shipping_policy(url):
    response = requests.get(url)
    response.raise_for_status()

    soup = BeautifulSoup(response.text, "html.parser")

    container = soup.find("div", class_="shopify-policy__body")
    if not container:
        return []

    sections = []
    current_title = None
    current_content_lines = []

    def add_section(title, content_lines):
        if title == "Registered Customers":
            return
        formatted_lines = []
        for line in content_lines:
            if line.startswith("-"):
                formatted_lines.append(line)
            else:
                formatted_lines.append(line)
        content_text = "\n".join(formatted_lines).strip()
        if content_text:
            sections.append({"title": title, "content": content_text})

    for elem in container.descendants:
        if elem.name in ["h1", "h4"]:
            if current_title and current_content_lines:
                add_section(current_title, current_content_lines)
                current_content_lines = []

            current_title = elem.get_text(strip=True)

        elif elem.name == "li":
            text = elem.get_text(strip=True)
            if text:
                current_content_lines.append(f"- {text}")

        elif elem.name == "p":
            text = elem.get_text(strip=True)
            if text:
                current_content_lines.append(text)
    if current_title and current_content_lines:
        add_section(current_title, current_content_lines)

    return sections


if __name__ == "__main__":
    url = "https://pinklily.com/policies/shipping-policy"
    policy_sections = fetch_shipping_policy(url)

    print(json.dumps(policy_sections, indent=2, ensure_ascii=False))
