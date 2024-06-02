import fs from 'fs';
import chalk from 'chalk';
import PackageJson from '../../package.json' assert { type: 'json' };

export const createVersionFile = (date: Date, versionPath: string, propertyName: string) => {
    console.log(chalk.cyan(`\nCreating version file at '${versionPath}' with prop '${propertyName}'`));
    createFile(date, versionPath, propertyName);
};

function createFile(date: Date, filePath: string, propName: string) {
    const timestamp = date.toUTCString();

    const src = `
export const ${propName} = {
	name: '${PackageJson.name}',
    timestamp: '${timestamp}',
    version: '${PackageJson.version}'
};
`;

    fs.writeFile(filePath, src, { flag: 'w' }, (err) => {
        if (err) {
            return console.log(chalk.red(err.message));
        }

        console.log(chalk.green(`Updating version ${chalk.yellow(PackageJson.version)}`));
        console.log(`${chalk.green('Writing version to ')}${chalk.yellow(filePath)}\n`);
    });
}
