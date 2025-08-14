import pandas as pd
import requests
import io

r = requests.get("http://localhost:8000/products/csv")
df = pd.read_csv(io.StringIO(r.text))
