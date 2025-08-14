from typing import List, Dict, Any
from docling.document_converter import DocumentConverter

converter = DocumentConverter()


def json_to_plain_text(json_data: List[Dict[str, Any]]) -> str:
    result_text = ""

    for item in json_data:
        title = item.get("title", "")
        result_text += title + "\n"

        content = item.get("content", "")

        if isinstance(content, str):
            result_text += content + "\n\n"
        elif isinstance(content, list):
            for sub_item in content:
                if isinstance(sub_item, dict):
                    for key, value in sub_item.items():
                        result_text += f"{value}\n"
                    result_text += "\n"
                else:
                    result_text += str(sub_item) + "\n"
            result_text += "\n"
        else:
            result_text += str(content) + "\n\n"

    return result_text
