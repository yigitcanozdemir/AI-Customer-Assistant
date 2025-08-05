import requests
import json
from bs4 import BeautifulSoup


def get_products(name):
    res = requests.get(f"https://{name}.com//products.json")
    data = res.json()

    for product in data["products"]:
        html = product.get("body_html", "")
        product["body_html"] = BeautifulSoup(html, "html.parser").get_text().strip()

    with open(f"{name}.json", "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)


get_products("ohpolly")
