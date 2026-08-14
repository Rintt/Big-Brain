export type DockerSandboxProvider = {
    type: "docker";
    image: string;
    installsOpenCode: false;
};
export declare function docker(): DockerSandboxProvider;
