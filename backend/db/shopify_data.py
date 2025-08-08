import requests
import json
import os
from bs4 import BeautifulSoup


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


def fetch_and_clean_products(name: str):
    print(f"Fetching from: https://{name}.com/products.json")
    res = requests.get(f"https://{name}.com/products.json")
    data = res.json()

    products = data.get("products", [])

    for product in products:
        html = product.get("body_html", "")
        text = BeautifulSoup(html, "html.parser").get_text().strip()
        cleaned = clean_body_html(text)
        product["body_html"] = cleaned

    output_path = f"jsons/{name}_cleaned.json"
    os.makedirs("jsons", exist_ok=True)

    with open(output_path, "w", encoding="utf-8") as f:
        json.dump({"products": products}, f, indent=2, ensure_ascii=False)

    print(f"Cleaned data written to {output_path}")


# Kullanım:
fetch_and_clean_products("pinklily")
