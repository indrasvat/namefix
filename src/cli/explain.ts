export const explanation = `
How namefix works:

1. Watch for new files in the configured directories.
2. When a new file is detected, it's checked against the include/exclude patterns.
3. If the file matches, it's checked to see if it already has the desired format.
4. If the file needs renaming, a new name is generated based on the file's creation date.
5. The new name is checked for conflicts with existing files.
6. If a conflict is found, a number is added to the end of the new name.
7. The file is renamed to the new name.
`;
