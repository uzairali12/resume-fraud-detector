# ==============================================================================
# 🚀 ULTIMATE CATCH-ALL LEGACY SCIKIT-LEARN COMPATIBILITY LAYER
# ==============================================================================
import sys
import types
import sklearn
import sklearn.ensemble
import sklearn.tree

# Create dynamic structural mappings for old sub-modules to new locations
legacy_mappings = {
    'sklearn.ensemble.forest': sklearn.ensemble,
    'sklearn.tree.tree': sklearn.tree,
    'sklearn.ensemble.weight_boosting': sklearn.ensemble,
    'sklearn.ensemble.gradient_boosting': sklearn.ensemble,
}

# Apply explicit common blockers immediately
for old_path, modern_module in legacy_mappings.items():
    sys.modules[old_path] = modern_module

# Catch-all fallback routing engine for any remaining unpickling path redirects
class LegacySklearnRedirector(types.ModuleType):
    def __getattr__(self, name):
        # If something looks for an old sub-module layout, try loading it from base sklearn
        try:
            return getattr(sklearn, name)
        except AttributeError:
            raise AttributeError(f"Module 'sklearn' has no legacy attribute '{name}'")

# Force register wildcard routes for common historical paths
sys.modules['sklearn.ensemble._forest'] = sklearn.ensemble
sys.modules['sklearn.tree._classes'] = sklearn.tree

print("🛡️ [COMPATIBILITY LAYER ACTIVE]: All legacy scikit-learn paths safely mapped.")
# ==============================================================================

import joblib
import re
import os
from pathlib import Path
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# 1. Initialize the FastAPI Application Engine
app = FastAPI(title="AI Resume Fraud Detector Backend")

# 2. Configure CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# 3. Initialize Supabase Client with a Smart Key Fallback Bypass
SUPABASE_URL = os.environ.get("SUPABASE_URL", "")
SUPABASE_KEY = os.environ.get("SUPABASE_SERVICE_ROLE_KEY", "")

if not SUPABASE_URL or "your-supabase" in SUPABASE_URL:
    print("\n⚠️  [MOCK MODE]: Running in MOCK DATABASE MODE.")
    supabase = None
else:
    try:
        from supabase import create_client, Client
        supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)
        print("\n✅ [DATABASE CONNECTED]: Linked with Supabase.")
    except Exception as init_err:
        print(f"\n❌ [DATABASE ERROR]: {init_err}. Falling back to Mock Mode.")
        supabase = None

# 4. Absolute Path Resolution for Option A (.pkl Native Fix)
model = None

try:
    BASE_DIR = Path(__file__).resolve().parent
    MODEL_PATH = BASE_DIR / "resume_fraud_model.pkl"
    
    if MODEL_PATH.exists():
        model = joblib.load(MODEL_PATH)
        print(f"🎯 [MODEL INITIALIZED]: Successfully loaded weights from absolute path: '{MODEL_PATH}'")
    else:
        print(f"❌ [PATH ERROR]: Model file does not exist at expected path: {MODEL_PATH}")

except Exception as e:
    print(f"❌ [CRITICAL MODEL ERROR]: Failed to load .pkl file: {e}")
    model = None

# 5. Define Structured Payload Schema Validators
class ResumeInput(BaseModel):
    resume_text: str
    user_email: str 

skills_lookup = ["python", "java", "react", "sql", "aws", "docker", "javascript", "html", "css", "c++", "linux", "excel", "tableau"]

# 6. Core REST API Evaluation Endpoint
@app.post("/api/v1/verify-resume")
async def verify_resume(payload: ResumeInput):
    if model is None:
        raise HTTPException(status_code=500, detail="Inference engine offline or .pkl artifact missing.")
    
    raw_text = payload.resume_text.strip()
    if not raw_text:
        raise HTTPException(status_code=400, detail="Extracted text block cannot be empty.")
    
    prediction = int(model.predict([raw_text])[0])
    probabilities = model.predict_proba([raw_text])[0]
    confidence = float(probabilities[prediction]) * 100
    
    text_lower = raw_text.lower()
    detected_skills = [s for s in skills_lookup if re.search(r'\b' + re.escape(s) + r'\b', text_lower)]
    verdict_string = "Suspicious / High Risk" if prediction == 1 else "Genuine / Low Risk"

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
        except Exception as db_err:
            print(f"⚠️ [DATABASE SAVE FAILED]: {db_err}")

    return {
        "prediction": prediction,
        "verdict": verdict_string,
        "confidence_percentage": round(confidence, 2),
        "detected_skills_list": detected_skills,
        "analytics": {
            "detected_skills_count": len(detected_skills),
            "detected_skills_list": detected_skills,
            "character_length": len(raw_text)
        }
    }

# 7. Server Health Route
@app.get("/api/health")
async def health():
    return {
        "status": "healthy",
        "model_loaded": model is not None,
        "database_connected": supabase is not None
    }

# 8. Essential Debug Endpoint from Your Breakdown
@app.get("/api/debug")
async def debug():
    BASE_DIR = Path(__file__).resolve().parent
    TARGET_PATH = BASE_DIR / "resume_fraud_model.pkl"
    
    load_error = None
    if TARGET_PATH.exists():
        try:
            joblib.load(TARGET_PATH)
        except Exception as e:
            load_error = str(e)
            
    return {
        "current_working_directory": os.getcwd(),
        "script_absolute_directory": str(BASE_DIR),
        "target_model_path_checked": str(TARGET_PATH),
        "file_physically_exists": TARGET_PATH.exists(),
        "unpickle_error_message": load_error if load_error else "None"
    }

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("index:app", host="127.0.0.1", port=8000, reload=True)