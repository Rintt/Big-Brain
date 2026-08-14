import path from "node:path";
export function docker() {
    return {
        type: "docker",
        image: `big-brain:${path.basename(process.cwd())}`,
        installsOpenCode: false
    };
}
//# sourceMappingURL=docker.js.map