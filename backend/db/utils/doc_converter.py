from typing import List, Dict, Any


def json_to_text(json_data: List[Dict[str, Any]]) -> str:
    result_text = ""

    for store in json_data:
        policies = store.get("policies", [])
        for item in policies:
            question = item.get("question", "")
            answer = item.get("answer", "")

            result_text += question + "\n"

            if isinstance(answer, str):
                result_text += answer + "\n\n"
            elif isinstance(answer, list):
                for sub_item in answer:
                    if isinstance(sub_item, dict):
                        for key, value in sub_item.items():
                            result_text += f"{value}\n"
                        result_text += "\n"
                    else:
                        result_text += str(sub_item) + "\n"
                result_text += "\n"
            else:
                result_text += str(answer) + "\n\n"

    return result_text.strip()
