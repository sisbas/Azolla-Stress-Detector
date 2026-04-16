import express from "express";
import cors from "cors";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  console.log("Starting server initialization...");
  try {
    const app = express();
    const PORT = 3000;
    const upload = multer({ storage: multer.memoryStorage() });

    app.use(cors());

    console.log("Importing pipeline and managers...");
    const { AzollaPipeline } = await import("./src/services/analyzer");
    const { OutputManager } = await import("./src/services/outputManager");

    const outputManager = new OutputManager();
    outputManager.initialize({
      alpha: 0.05,
      earlyWeights: { rg_ratio: 0.4, coverage: 0.2, entropy: 0.2, mean_g: 0.2 }
    });

    console.log(`Experiment initialized: ${outputManager.getExperimentId()}`);

    // Global Middleware
    app.use(express.json({ limit: "50mb" }));
    app.use(express.urlencoded({ extended: true, limit: "50mb" }));
    
    app.use((req, res, next) => {
      const start = Date.now();
      res.on("finish", () => {
        const duration = Date.now() - start;
        console.log(`[${new Date().toISOString()}] ${req.method} ${req.url} ${res.statusCode} - ${duration}ms`);
      });
      next();
    });

    console.log("Registering routes...");
    
    // API Routes
    app.get("/api/health", (req, res) => {
      res.json({ 
        status: "ok", 
        timestamp: new Date().toISOString(),
        experimentId: outputManager.getExperimentId()
      });
    });

    app.post("/api/analyze", upload.single("image"), async (req, res) => {
      try {
        if (!req.file) {
          return res.status(400).json({ error: "No image uploaded" });
        }

        const { colormap } = req.body;
        const pipeline = new AzollaPipeline();
        const result = await pipeline.process(req.file.buffer, Date.now(), colormap);

        // Save intermediate features
        if (result.features) {
          outputManager.saveIntermediate("features", result.features, `feat_${result.features.timestamp}`);
        }

        res.json(result);
      } catch (error) {
        console.error("Analysis error:", error);
        res.status(500).json({ error: "Analysis failed", details: error instanceof Error ? error.message : String(error) });
      }
    });

    app.post("/api/report", async (req, res) => {
      console.log("Final report generation started");
      try {
        const { decisions, validationData, figures } = req.body;
        
        outputManager.logAudit("Starting final report generation");

        // 1. Save decisions as CSV (simulated as JSON for now, but we can write CSV string)
        outputManager.saveIntermediate("final", decisions, "decisions");

        // 2. Save figures if provided
        if (figures) {
          Object.entries(figures).forEach(([name, data]) => {
            outputManager.saveFigure(name, data as string);
          });
        }

        // 3. Generate final report and LaTeX
        const report = outputManager.createFinalReport(decisions, validationData);
        
        outputManager.logAudit(`Pipeline completed. Results stored in: ${outputManager.getExperimentId()}`);
        console.log(`Report generated: ${outputManager.getExperimentId()}`);
        
        res.json(report);
      } catch (error) {
        console.error("Report generation error:", error);
        outputManager.logAudit(`Report generation failed: ${error instanceof Error ? error.message : String(error)}`);
        res.status(500).json({ error: "Failed to generate report" });
      }
    });

    // API 404 Handler - Prevent falling through to Vite for missing API routes
    app.all("/api/*", (req, res) => {
      console.warn(`API Route not found: ${req.method} ${req.url}`);
      res.status(404).json({ error: "API route not found" });
    });

    // Global Error Handler
    app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
      console.error("Unhandled Error:", err);
      if (req.path.startsWith("/api/")) {
        res.status(500).json({ 
          error: "Internal Server Error", 
          message: err.message,
          stack: process.env.NODE_ENV === "development" ? err.stack : undefined
        });
      } else {
        next(err);
      }
    });

    // API 404 Handler
    app.all("/api/*", (req, res) => {
      res.status(404).json({ error: "API route not found" });
    });

    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      console.log("Starting Vite in middleware mode...");
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("CRITICAL: Failed to start server:", err);
    process.exit(1);
  }
}

startServer().catch(err => {
  console.error("CRITICAL: Unhandled error in startServer:", err);
  process.exit(1);
});
