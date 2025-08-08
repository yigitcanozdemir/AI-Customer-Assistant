import requests
import json
import uuid


def send_test_event():
    url = "http://localhost:8000/events/"

    event_data = {
        "event_id": str(uuid.uuid4()),
        "event_type": "chat",
        "event_data": {"question": "What is your return policy?", "store": "pinklily"},
    }

    headers = {
        "Content-Type": "application/json",
        "Authorization": "Bearer your-secret-token",
    }

    response = requests.post(url=url, data=json.dumps(event_data), headers=headers)
    print("==== FULL RESPONSE ====")
    print(
        json.dumps(
            {
                "status": response.status_code,
                "headers": dict(response.headers),
                "body": response.json(),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    send_test_event()
