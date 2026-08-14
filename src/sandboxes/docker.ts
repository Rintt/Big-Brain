import path from "node:path";

export type DockerSandboxProvider = {
  type: "docker";
  image: string;
  installsOpenCode: true;
};

export function docker(): DockerSandboxProvider {
  return {
    type: "docker",
    image: `big-brain:${path.basename(process.cwd())}`,
    installsOpenCode: true
  };
}
