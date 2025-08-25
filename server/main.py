from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware


app = FastAPI(root_path="/api/v1/resource")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/healthz")
def healthz():
    return { "message": "Service healthy." }
