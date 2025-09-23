/**
 * Utility for dynamic import of jose library
 * This handles the ES Module import in CommonJS environment
 */

let joseModule: any = null;

export async function getJoseModule() {
    if (joseModule) {
        return joseModule;
    }
    
    try {
        // Use dynamic import with proper error handling
        // Using Function constructor to avoid TypeScript transformation
        const dynamicImport = new Function('specifier', 'return import(specifier)');
        joseModule = await dynamicImport('jose');
        return joseModule;
    } catch (error) {
        console.error('❌ Failed to import jose library:', error);
        throw new Error('Jose library import failed');
    }
}

export async function getSignJWT() {
    const jose = await getJoseModule();
    return jose.SignJWT;
}

export async function getJwtVerify() {
    const jose = await getJoseModule();
    return jose.jwtVerify;
}
