import joblib
import re
import os
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 1. Initialize the FastAPI Application Engine
app = FastAPI(title="AI Resume Fraud Detector Backend")

# 2. Configure CORS Middleware (Allows your frontend layers to talk to this API)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Initialize Supabase Client with a Smart Key Fallback Bypass (Mock Mode Check)
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or "your-supabase" in SUPABASE_URL:
    print("\n⚠️  [MOCK MODE NOTICE]: Running in MOCK DATABASE MODE.")
    print("👉 Predictions will process via ML Model, but audit trails won't be saved online.\n")
    supabase = None
else:
    try:
        from supabase import create_client, Client
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("\n✅ [DATABASE CONNECTED]: Successfully established link with Supabase cloud storage.\n")
    except Exception as init_err:
        print(f"\n❌ [DATABASE ERROR]: Failed to load database client: {init_err}")
        print("Falling back into Mock Mode to keep server alive...\n")
        supabase = None

# ==============================================================================
# 4. Safely Locate and Load the Saved Serialized Model File (.pkl)
# ==============================================================================
# This array prioritizes the local 'api/' directory folder, then checks fallback roots
possible_paths = [
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "resume_fraud_model.pkl"),  # 1. Same folder as index.py (api/)
    os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "resume_fraud_model.pkl"),  # 2. Project Root Directory
    "resume_fraud_model.pkl",  # 3. Relative execution directory path string
    "/var/task/api/resume_fraud_model.pkl",  # 4. Vercel Serverless Function isolated task environment container
    "/var/task/resume_fraud_model.pkl"  # 5. Alternate Vercel workspace container path
]

model = None
for path in possible_paths:
    print(f"🔍 [PATH AUDIT]: Checking for model configuration layout at: '{path}'")
    if os.path.exists(path):
        try:
            model = joblib.load(path)
            print(f"🎯 [MODEL INITIALIZED]: Successfully loaded native weights from path: '{path}'")
            break
        except Exception as e:
            print(f"⚠️ Found file at {path} but failed to extract weights: {e}")

if model is None:
    print("❌ [CRITICAL MODEL ERROR]: All directory path resolutions exhausted. Native .pkl artifact missing.")

# ==============================================================================

# 5. Define Structured Payload Schema Validators (Pydantic DataType Rules)
class ResumeInput(BaseModel):
    resume_text: str
    user_email: str 

# List of tracking keys to supply analytics dashboards
skills_lookup = ["python", "java", "react", "sql", "aws", "docker", "javascript", "html", "css", "c++", "linux", "excel", "tableau"]

# 6. Core REST API Evaluation Endpoint
@app.post("/api/v1/verify-resume")
async def verify_resume(payload: ResumeInput):
    if model is None:
        raise HTTPException(status_code=500, detail="Inference engine offline or .pkl artifact missing.")
    
    raw_text = payload.resume_text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Extracted text block cannot be empty.")
    
    # Run text variables through the Random Forest Classifier
    prediction = int(model.predict([raw_text])[0])
    probabilities = model.predict_proba([raw_text])[0]
    confidence = float(probabilities[prediction]) * 100
    
    # Calculate parsing match counts for UI reporting layout engines
    text_lower = raw_text.lower()
    detected_skills = [s for s in skills_lookup if re.search(r'\b' + re.escape(s) + r'\b', text_lower)]
    verdict_string = "Suspicious / High Risk" if prediction == 1 else "Genuine / Low Risk"

    # 7. Write Historical Log Entry (Only if connected to a real database)
    if supabase is not None:
        try:
            db_record = {
                "clerk_email": payload.user_email,
                "skills_count": len(detected_skills),
                "prediction_label": prediction,
                "verdict": verdict_string,
                "confidence_score": round(confidence, 2),
                "character_length": len(raw_text)
            }
            supabase.table("resume_audits").insert(db_record).execute()
            print(f"💾 [AUDIT SAVED]: Successfully recorded processing trace for {payload.user_email}")
        except Exception as db_err:
            print(f"⚠️ [DATABASE SAVE FAILED]: Could not stream log item to cloud: {db_err}")
    else:
        print(f"⏩ [MOCK RUN SUCCESS]: Checked text for {payload.user_email}. Skipped database execution sync.")

    # 8. Return JSON Response payload directly back to the JS app handler
    return {
        "prediction": prediction,
        "verdict": verdict_string,
        "confidence_percentage": round(confidence, 2),
        "detected_skills_list": detected_skills,  # Core frontend tracking element key root
        "analytics": {
            "detected_skills_count": len(detected_skills),
            "detected_skills_list": detected_skills,
            "character_length": len(raw_text)
        }
    }

# 9. Server Health Route
@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "database_connected": supabase is not None
    }

if __name__ == "__main__":
    import uvicorn
    print("🚀 Launching local development environment engine...")
    uvicorn.run("index:app", host="127.0.0.1", port=8000, reload=True)