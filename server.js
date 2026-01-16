const helmet = require('helmet');
const express = require('express');
const path = require('path');
const cors = require('cors');
const Database = require('better-sqlite3');
const fs = require('fs');

// --- Config ---
const PORT = 8080;
const BASE_URL = process.env.BASE_URL || '/';
const DB_PATH = process.env.DB_PATH || '/data/storage.db';

// --- Database Setup ---
const dbDir = path.dirname(DB_PATH);
// We add a try/catch check here just in case, though Docker handles it.
try {
    if (!fs.existsSync(dbDir)) {
        // This might fail in distroless if permissions aren't right, 
        // but we handled that in the builder stage.
        fs.mkdirSync(dbDir, { recursive: true });
    }
} catch (e) {
    console.error("Warning: Could not verify/create DB directory. Assuming it exists via Docker volume.", e);
}
const db = new Database(DB_PATH);

// Table 1: DEFINITIONS (Stores the test structure/logic)
db.exec(`
  CREATE TABLE IF NOT EXISTS definitions (
    project_name TEXT PRIMARY KEY,
    payload JSON
  )
`);

// Table 2: SUBMISSIONS (Stores the actual user results)
db.exec(`
  CREATE TABLE IF NOT EXISTS submissions (
    id TEXT PRIMARY KEY,
    project_name TEXT,
    timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
    payload JSON,
    FOREIGN KEY(project_name) REFERENCES definitions(project_name)
  )
`);

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            // Allow assets from valid sources
            defaultSrc: ["'self'"], 
            
            // Allow scripts from your server, unpkg (Lucide), and inline scripts
            scriptSrc: [
                "'self'", 
                "'unsafe-inline'", 
                "https://unpkg.com", 
                "'unsafe-eval'",
                "https://cdn.jsdelivr.net",
                "https://cdn.tailwindcss.com" 
            ],
            "script-src-attr": ["'unsafe-inline'"],
            // Allow images/icons (Lucide creates SVGs, sometimes treated as images)
            imgSrc: ["'self'", "data:", "blob:"],
            
            // Allow connecting to your own API
            connectSrc: ["'self'"] 
        },
    },
}));
const router = express.Router();

router.post('/upload', (req, res) => {
    try {
        const body = req.body;
        const rootKeys = Object.keys(body);
        if (rootKeys.length === 0) return res.status(400).send("Empty JSON");

        // The unique key (e.g., "Sleep_Test_23_Female-UUID" or just "Sleep_Test")
        const uniqueID = rootKeys[0]; 
        const content = body[uniqueID]; // The actual data inside

        // Identify the Project Name from the content
        const projectName = content.project || (content.quiz && content.quiz.project);

        if (!projectName) {
            return res.status(400).send("Invalid JSON: 'project' field missing.");
        }

        // --- LOGIC BRANCH ---

        // CHECK 1: Is this a Test Definition?
        // We assume it's a definition if it contains "questions" or "logic" fields
        if (content.questions || content.logic) {
            console.log(`[INFO] Received Definition for: ${projectName}`);
            
            const stmt = db.prepare(`
                INSERT OR REPLACE INTO definitions (project_name, payload) 
                VALUES (?, ?)
            `);
            stmt.run(projectName, JSON.stringify(body));
            
            return res.status(200).send("Definition Saved");
        }

        // CHECK 2: It is a User Submission (Result)
        else {
            // 2a. Do we know this project?
            const defCheck = db.prepare('SELECT 1 FROM definitions WHERE project_name = ?').get(projectName);

            if (!defCheck) {
                console.log(`[412] Unknown Project: ${projectName}. Requesting definition.`);
                // This triggers the client to send the definition next
                return res.status(412).send("Precondition Failed: Project definition not found");
            }

            // 2b. We know the project, so save the result
            try {
                const stmt = db.prepare('INSERT INTO submissions (id, project_name, payload) VALUES (?, ?, ?)');
                stmt.run(uniqueID, projectName, JSON.stringify(body));
                
                console.log(`[200] Submission Saved: ${uniqueID}`);
                return res.status(200).send("OK");
            } catch (err) {
                if (err.code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
                    console.log(`[INFO] Duplicate submission ignored: ${uniqueID}`);
                    return res.status(200).send("Already Saved");
                }
                throw err;
            }
        }

    } catch (e) {
        console.error(e);
        return res.status(500).send("Internal Server Error");
    }
});

// Static Files
router.use('/', express.static(path.join(__dirname, 'public')));

// Mount Router
app.use(BASE_URL, router);

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT} with BaseURL: ${BASE_URL}`);
});