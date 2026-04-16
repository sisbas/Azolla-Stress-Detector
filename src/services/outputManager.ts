import fs from "fs";
import path from "path";
import crypto from "crypto";
import os from "os";
import { FeatureRecord } from "./analyzer";
import { DecisionRecord } from "./decider";
import { ValidationMetrics, BootstrapResult } from "./validation";

export interface PipelineMetadata {
  pipeline_version: string;
  config_hash: string;
  data_hash: string;
  node_version: string;
  package_versions: Record<string, string>;
  random_seed: number;
  execution_timestamp: string;
  hardware_signature: string;
}

export interface FinalReport {
  metadata: PipelineMetadata;
  decisions: DecisionRecord[];
  validation: {
    cv_summary: any;
    bootstrap_95ci: [number, number];
  };
  latex_snippet: string;
}

export class OutputManager {
  private basePath: string;
  private experimentId: string;
  private metadata: PipelineMetadata | null = null;

  constructor(baseDir: string = "reports", experimentId?: string) {
    this.experimentId = experimentId || `exp_${new Date().getTime()}`;
    this.basePath = path.join(process.cwd(), baseDir, this.experimentId);
    
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  public initialize(config: any, randomSeed: number = 42) {
    const configStr = JSON.stringify(config, Object.keys(config).sort());
    const configHash = crypto.createHash("sha256").update(configStr).digest("hex").substring(0, 16);

    this.metadata = {
      pipeline_version: "1.0.0",
      config_hash: configHash,
      data_hash: "", // Updated per data load
      node_version: process.version,
      package_versions: {
        sharp: "0.34.5",
        express: "4.21.2",
        typescript: "5.8.2"
      },
      random_seed: randomSeed,
      execution_timestamp: new Date().toISOString(),
      hardware_signature: `${os.hostname()}_${os.arch()}_${os.platform()}`
    };

    this.saveMetadata();
  }

  private saveMetadata() {
    if (!this.metadata) return;
    const metaPath = path.join(this.basePath, "metadata.json");
    fs.writeFileSync(metaPath, JSON.stringify(this.metadata, null, 2));
  }

  public saveIntermediate(stage: string, data: any, filename: string) {
    const stagePath = path.join(this.basePath, "intermediate", stage);
    if (!fs.existsSync(stagePath)) {
      fs.mkdirSync(stagePath, { recursive: true });
    }

    const filePath = path.join(stagePath, `${filename}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
    this.logAudit(`Saved intermediate ${stage}: ${filename}`);
  }

  public saveDecisionsCSV(decisions: DecisionRecord[]) {
    const finalPath = path.join(this.basePath, "final");
    if (!fs.existsSync(finalPath)) {
      fs.mkdirSync(finalPath, { recursive: true });
    }

    const header = "timestamp,decision,early_stress_prob,confidence,rationale\n";
    const rows = decisions.map(d => 
      `${d.timestamp},${d.decision},${d.early_stress_prob.toFixed(4)},${d.confidence.toFixed(4)},"${d.rationale.replace(/"/g, '""')}"`
    ).join("\n");

    fs.writeFileSync(path.join(finalPath, "decisions.csv"), header + rows);
    
    // Also save rationale log
    const logContent = decisions.map(d => `[${new Date(d.timestamp).toISOString()}] ${d.decision.toUpperCase()}: ${d.rationale}`).join("\n");
    fs.writeFileSync(path.join(finalPath, "rationale_log.txt"), logContent);
    
    this.logAudit("Saved final decisions CSV and rationale log");
  }

  public saveFigure(name: string, base64Data: string) {
    const figuresPath = path.join(this.basePath, "figures");
    if (!fs.existsSync(figuresPath)) {
      fs.mkdirSync(figuresPath, { recursive: true });
    }

    const buffer = Buffer.from(base64Data.split(",")[1] || base64Data, "base64");
    fs.writeFileSync(path.join(figuresPath, `${name}.png`), buffer);
    this.logAudit(`Saved figure: ${name}`);
  }

  public logAudit(message: string) {
    const logPath = path.join(this.basePath, "audit_log.txt");
    const timestamp = new Date().toISOString();
    fs.appendFileSync(logPath, `[${timestamp}] ${message}\n`);
  }

  public generateLatexSnippet(decisions: DecisionRecord[], val: any): string {
    const earlyCount = decisions.filter(d => d.decision === "early_stress").length;
    const total = decisions.length;
    const aucMean = val?.cv?.reduce((acc: number, curr: any) => acc + curr.auc, 0) / (val?.cv?.length || 1);
    const ci = val?.bootstrap?.ci_95 || [0, 0];
    const recallMean = val?.cv?.reduce((acc: number, curr: any) => acc + curr.recall, 0) / (val?.cv?.length || 1);

    return `
\\begin{table}[h]
\\centering
\\caption{Erken Stres Tespit Performansı (n=${total} zaman noktası)}
\\begin{tabular}{lcc}
\\toprule
Metrik & Değer & %95 GA \\\\
\\midrule
Erken Stres Tespit Oranı & ${(earlyCount / (total || 1) * 100).toFixed(1)}\\% & -- \\\\
ROC-AUC (ortalama) & ${aucMean.toFixed(3)} & [${ci[0].toFixed(3)}, ${ci[1].toFixed(3)}] \\\\
Ortalama Recall & ${recallMean.toFixed(3)} & -- \\\\
\\bottomrule
\\end{tabular}
\\end{table}
`;
  }

  public createFinalReport(decisions: DecisionRecord[], validationData: any): FinalReport {
    const latex = this.generateLatexSnippet(decisions, validationData);
    
    // Save CSV and Rationale
    this.saveDecisionsCSV(decisions);

    // Save Validation Summary
    const finalPath = path.join(this.basePath, "final");
    if (!fs.existsSync(finalPath)) {
      fs.mkdirSync(finalPath, { recursive: true });
    }
    fs.writeFileSync(
      path.join(finalPath, "validation_summary.json"), 
      JSON.stringify(validationData, null, 2)
    );

    const report: FinalReport = {
      metadata: this.metadata!,
      decisions,
      validation: {
        cv_summary: validationData.cv,
        bootstrap_95ci: validationData.bootstrap.ci_95
      },
      latex_snippet: latex
    };

    const reportPath = path.join(this.basePath, "final_report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    const latexPath = path.join(this.basePath, "performance_table.tex");
    fs.writeFileSync(latexPath, latex);

    return report;
  }

  public getExperimentId(): string {
    return this.experimentId;
  }
}
