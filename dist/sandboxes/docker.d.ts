export type DockerSandboxProvider = {
    type: "docker";
    image: string;
    installsOpenCode: true;
};
export declare function docker(): DockerSandboxProvider;
