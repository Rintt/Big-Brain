import path from "node:path";

export type DockerSandboxProvider = {
  type: "docker";
  image: string;
  installsOpenCode: false;
};

export function docker(): DockerSandboxProvider {
  return {
    type: "docker",
    image: `big-brain:${path.basename(process.cwd())}`,
    installsOpenCode: false
  };
}
