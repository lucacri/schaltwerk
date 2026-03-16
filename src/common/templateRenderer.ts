export function renderTemplate(
    template: string,
    variables: Record<string, string>
): string {
    return template.replace(/\{\{(\w+\.\w+)\}\}/g, (match, key: string) => {
        return key in variables ? variables[key] : match
    })
}
